import { translate as t } from './i18n.js';

export const STORAGE_KEY = 'pptLiveStudioStateV6';
export const HISTORY_KEY = 'pptLiveDeckHistoryV1';
export const SCHEMA_VERSION = 5;
export const ELEMENT_TYPES = ['text', 'list', 'shape', 'metric', 'chart', 'media'];

export const THEME_PRESETS = {
  executive: {
    name: 'Executive',
    background: '#fbfcff',
    ink: '#111827',
    muted: '#5b6575',
    primary: '#0f766e',
    accent: '#f97316',
    panel: '#ffffff',
  },
  market: {
    name: 'Market',
    background: '#fffdf7',
    ink: '#1f2937',
    muted: '#6b5f50',
    primary: '#2563eb',
    accent: '#d97706',
    panel: '#ffffff',
  },
  minimal: {
    name: 'Minimal',
    background: '#f8fafc',
    ink: '#0f172a',
    muted: '#64748b',
    primary: '#334155',
    accent: '#0f766e',
    panel: '#ffffff',
  },
  studio: {
    name: 'Studio',
    background: '#fcfbff',
    ink: '#1f1630',
    muted: '#6c607a',
    primary: '#7c3aed',
    accent: '#db2777',
    panel: '#ffffff',
  },
};

export function uid(prefix = 'id') {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

export function defaultBrief() {
  return {
    topic: '',
    audience: '',
    material: '',
    deckType: 'strategy',
    tone: 'executive',
    slideTarget: 8,
    imagePolicy: 'placeholders',
  };
}

export function methodologyFor(deckType = 'strategy') {
  const profiles = {
    strategy: {
      profile: 'strategy-leadership',
      thesis: 'Decision-led transformation narrative',
      proofObjects: ['market map', 'operating model', 'risk bridge', 'decision table'],
      arc: ['thesis', 'context', 'friction', 'strategic bet', 'operating model', 'proof', 'risks', 'decision'],
    },
    sales: {
      profile: 'gtm-growth',
      thesis: 'Buyer pain to differentiated value narrative',
      proofObjects: ['before/after workflow', 'value bridge', 'customer proof', 'implementation plan'],
      arc: ['outcome', 'market shift', 'pain', 'solution', 'proof', 'commercial case', 'rollout', 'call to action'],
    },
    report: {
      profile: 'finance-ir',
      thesis: 'Executive performance narrative with decisions attached',
      proofObjects: ['metric bridge', 'trend chart', 'variance table', 'risk register'],
      arc: ['summary', 'scorecard', 'movement', 'root cause', 'metric proof', 'risk', 'plan', 'decision'],
    },
    teaching: {
      profile: 'education',
      thesis: 'Concept to application learning journey',
      proofObjects: ['concept map', 'worked example', 'comparison', 'practice prompt'],
      arc: ['goal', 'map', 'concept', 'example', 'mistakes', 'practice', 'summary', 'next step'],
    },
    fundraising: {
      profile: 'fundraising',
      thesis: 'Venture-scale opportunity supported by traction evidence',
      proofObjects: ['market wedge', 'product diagram', 'traction chart', 'milestone plan'],
      arc: ['thesis', 'problem', 'solution', 'market', 'product', 'traction', 'model', 'ask'],
    },
  };
  return profiles[deckType] || profiles.strategy;
}

export function defaultStyle() {
  return {
    theme: 'executive',
    density: 'standard',
    brandPrimary: '#0f766e',
    brandAccent: '#f97316',
  };
}

export function defaultOutline() {
  return [
    t('defaultDeckTitle'),
    'Why now',
    'Current friction',
    'Strategic answer',
    'Core workflow',
    'Proof and impact',
    'Rollout plan',
    'Decision and next steps',
  ];
}

export function createInitialState() {
  const state = {
    schemaVersion: SCHEMA_VERSION,
    sessionId: uid('deck'),
    title: t('blankDeckTitle'),
    brief: defaultBrief(),
    style: defaultStyle(),
    outline: [],
    sources: { items: [], facts: [], warnings: [], summary: '', fetchedAt: 0 },
    slides: [],
    activeSlideId: '',
    selectedElementId: '',
    mode: 'edit',
    presentIndex: 0,
    status: 'ready',
    generation: {
      active: false,
      current: 'idle',
      steps: generationSteps().map((step) => ({ ...step, status: 'pending' })),
      events: [],
    },
    chatMessages: [{ role: 'assistant', text: t('assistantHello') }],
    updatedAt: Date.now(),
  };
  return state;
}

export function ensureState(value) {
  const state = {
    ...createInitialState(),
    ...(value || {}),
  };
  state.schemaVersion = SCHEMA_VERSION;
  state.brief = { ...defaultBrief(), ...(state.brief || {}) };
  state.style = { ...defaultStyle(), ...(state.style || {}) };
  if (!['strategy', 'sales', 'report', 'teaching', 'fundraising'].includes(state.brief.deckType)) state.brief.deckType = 'strategy';
  if (!['executive', 'concise', 'persuasive', 'educational'].includes(state.brief.tone)) state.brief.tone = 'executive';
  if (!['placeholders', 'none'].includes(state.brief.imagePolicy)) state.brief.imagePolicy = 'placeholders';
  if (!Object.keys(THEME_PRESETS).includes(state.style.theme)) state.style.theme = 'executive';
  if (!['compact', 'standard', 'spacious'].includes(state.style.density)) state.style.density = 'standard';
  state.generation = normalizeGeneration(state.generation);
  state.sources = normalizeSources(state.sources);
  state.brief.slideTarget = clamp(Number(state.brief.slideTarget) || 8, 3, 24);
  const keepEmptyGeneratingDeck = state.generation.active
    && Array.isArray(state.slides)
    && state.slides.length === 0;
  state.outline = keepEmptyGeneratingDeck
    ? []
    : Array.isArray(state.outline)
    ? state.outline.map((item) => String(item || t('newSlideTitle')))
    : [];
  state.slides = keepEmptyGeneratingDeck
    ? []
    : Array.isArray(state.slides) && state.slides.length > 0
    ? state.slides.map((slide, index) => normalizeSlide(slide, index, state))
    : state.outline.length > 0
    ? state.outline.map((title, index) => makeSlide(title, index, state.outline.length, state))
    : [];
  if (!state.slides.some((slide) => slide.id === state.activeSlideId)) {
    state.activeSlideId = state.slides[0]?.id || '';
  }
  const active = getActiveSlide(state);
  if (!active?.elements.some((element) => element.id === state.selectedElementId)) {
    state.selectedElementId = active?.elements[0]?.id || '';
  }
  state.title = state.title || state.slides[0]?.title || t('defaultDeckTitle');
  state.updatedAt = Date.now();
  return state;
}

export function normalizeSources(value = {}) {
  return {
    items: Array.isArray(value.items) ? value.items : [],
    facts: Array.isArray(value.facts) ? value.facts : [],
    warnings: Array.isArray(value.warnings) ? value.warnings : [],
    summary: typeof value.summary === 'string' ? value.summary : '',
    fetchedAt: Number(value.fetchedAt || 0),
  };
}

export function generationSteps() {
  return [
    { id: 'brief', label: t('generationStepBrief'), detail: t('generationStepBriefDetail') },
    { id: 'spine', label: t('generationStepSpine'), detail: t('generationStepSpineDetail') },
    { id: 'proof', label: t('generationStepProof'), detail: t('generationStepProofDetail') },
    { id: 'design', label: t('generationStepDesign'), detail: t('generationStepDesignDetail') },
    { id: 'compile', label: t('generationStepCompile'), detail: t('generationStepCompileDetail') },
  ];
}

export function normalizeGeneration(value = {}) {
  const known = new Map((Array.isArray(value.steps) ? value.steps : []).map((step) => [step.id, step]));
  return {
    active: Boolean(value.active),
    current: value.current || 'idle',
    steps: generationSteps().map((step) => ({
      ...step,
      status: known.get(step.id)?.status || 'pending',
    })),
    events: Array.isArray(value.events) ? value.events.slice(-20) : [],
  };
}

export function getActiveSlide(state) {
  return state.slides.find((slide) => slide.id === state.activeSlideId) || state.slides[0];
}

export function getActiveIndex(state) {
  return Math.max(0, state.slides.findIndex((slide) => slide.id === state.activeSlideId));
}

export function getSelectedElement(state) {
  const slide = getActiveSlide(state);
  return slide?.elements.find((element) => element.id === state.selectedElementId) || null;
}

export function makeSlide(title, index, total, state = { brief: defaultBrief(), style: defaultStyle(), slides: [] }) {
  const theme = resolveDeckTheme(state, index);
  const slide = {
    id: uid('slide'),
    title: title || `${t('newSlideTitle')} ${index + 1}`,
    subtitle: '',
    kicker: kickerForIndex(index, state),
    claim: claimFor(title, index, state),
    proofObject: proofObjectForIndex(index, state),
    supportNote: supportNoteFor(title, index, state),
    sourceNote: sourceNoteFor(state),
    notes: t('defaultSpeakerNote', { title }),
    layout: layoutForIndex(index, total),
    theme,
    elements: [],
  };
  slide.elements = elementsForLayout(slide, index, total, state);
  return normalizeSlide(slide, index, state);
}

export function normalizeSlide(slide, index, state) {
  const title = slide?.title || `${t('newSlideTitle')} ${index + 1}`;
  const normalized = {
    id: slide?.id || uid('slide'),
    title,
    subtitle: slide?.subtitle || '',
    kicker: String(slide?.kicker || kickerForIndex(index, state)),
    claim: String(slide?.claim || claimFor(title, index, state)),
    proofObject: String(slide?.proofObject || proofObjectForIndex(index, state)),
    supportNote: String(slide?.supportNote || supportNoteFor(title, index, state)),
    sourceNote: String(slide?.sourceNote || sourceNoteFor(state)),
    notes: slide?.notes || '',
    layout: slide?.layout || layoutForIndex(index, state?.slides?.length || 1),
    theme: { ...resolveDeckTheme(state, index), ...(slide?.theme || slide?.style || {}) },
    html: typeof slide?.html === 'string' ? slide.html : '',
    elements: [],
  };
  const source = Array.isArray(slide?.elements) && slide.elements.length > 0
    ? slide.elements
    : elementsForLayout(normalized, index, state?.slides?.length || 1, state);
  normalized.elements = source.map((element) => normalizeElement(element));
  return normalized;
}

export function normalizeElement(element = {}) {
  const type = ELEMENT_TYPES.includes(element.type) ? element.type : 'text';
  const defaults = defaultElement(type);
  return {
    ...defaults,
    ...element,
    id: element.id || uid('el'),
    type,
    x: clamp(Number(element.x ?? defaults.x), 0, 98),
    y: clamp(Number(element.y ?? defaults.y), 0, 98),
    w: clamp(Number(element.w ?? defaults.w), 3, 100),
    h: clamp(Number(element.h ?? defaults.h), 3, 100),
    text: typeof element.text === 'string' ? element.text : defaults.text,
    label: typeof element.label === 'string' ? element.label : defaults.label,
    items: Array.isArray(element.items) ? element.items.map(String) : defaults.items,
    data: Array.isArray(element.data) ? element.data.map(normalizeChartPoint) : defaults.data,
    style: normalizeStyle({ ...defaults.style, ...(element.style || {}) }),
  };
}

function normalizeChartPoint(point, index) {
  if (typeof point === 'number') return { label: `Q${index + 1}`, value: point };
  return {
    label: String(point?.label || `Item ${index + 1}`),
    value: Number(point?.value || 0),
  };
}

export function normalizeStyle(style = {}) {
  return {
    fontSize: clamp(Number(style.fontSize || 24), 8, 88),
    fontWeight: clamp(Number(style.fontWeight || 600), 100, 900),
    color: style.color || 'ink',
    background: style.background || 'transparent',
    opacity: clamp(Number(style.opacity ?? 1), 0, 1),
    borderRadius: clamp(Number(style.borderRadius || 0), 0, 99),
    align: style.align || 'left',
  };
}

export function defaultElement(type) {
  const map = {
    text: {
      text: 'Key message',
      label: '',
      items: [],
      data: [],
      x: 8,
      y: 12,
      w: 60,
      h: 16,
      style: { fontSize: 38, fontWeight: 780, color: 'ink', background: 'transparent', borderRadius: 0, opacity: 1, align: 'left' },
    },
    list: {
      text: '',
      label: '',
      items: ['First point', 'Second point', 'Third point'],
      data: [],
      x: 9,
      y: 36,
      w: 48,
      h: 40,
      style: { fontSize: 20, fontWeight: 500, color: 'ink', background: 'transparent', borderRadius: 8, opacity: 1, align: 'left' },
    },
    shape: {
      text: '',
      label: '',
      items: [],
      data: [],
      x: 66,
      y: 14,
      w: 24,
      h: 62,
      style: { fontSize: 18, fontWeight: 600, color: 'accent', background: 'primary', borderRadius: 22, opacity: 0.12, align: 'center' },
    },
    metric: {
      text: '3x',
      label: 'Faster first draft',
      items: [],
      data: [],
      x: 63,
      y: 42,
      w: 26,
      h: 26,
      style: { fontSize: 44, fontWeight: 820, color: 'primary', background: 'panel', borderRadius: 14, opacity: 1, align: 'left' },
    },
    chart: {
      text: 'Signal trend',
      label: '',
      items: [],
      data: [{ label: 'Now', value: 42 }, { label: 'Next', value: 68 }, { label: 'Target', value: 86 }],
      x: 52,
      y: 36,
      w: 36,
      h: 32,
      style: { fontSize: 18, fontWeight: 700, color: 'ink', background: 'panel', borderRadius: 14, opacity: 1, align: 'left' },
    },
    media: {
      text: t('mediaPlaceholder'),
      label: '',
      items: [],
      data: [],
      x: 58,
      y: 18,
      w: 32,
      h: 42,
      style: { fontSize: 16, fontWeight: 650, color: 'muted', background: 'soft', borderRadius: 16, opacity: 1, align: 'center' },
    },
  };
  return { ...clone(map[type] || map.text), type: map[type] ? type : 'text' };
}

function resolveDeckTheme(state, index = 0) {
  const preset = THEME_PRESETS[state?.style?.theme || 'executive'] || THEME_PRESETS.executive;
  const primary = state?.style?.brandPrimary || preset.primary;
  const accent = state?.style?.brandAccent || preset.accent;
  return {
    ...preset,
    primary: index % 2 ? accent : primary,
    accent: index % 2 ? primary : accent,
  };
}

function layoutForIndex(index, total) {
  if (index === 0) return 'cover';
  if (index === total - 1) return 'closing';
  return ['split', 'metric', 'process', 'comparison'][index % 4];
}

function kickerForIndex(index, state) {
  const method = methodologyFor(state?.brief?.deckType);
  const role = method.arc[index % method.arc.length] || 'proof';
  return role.replace(/[-_]/g, ' ').toUpperCase();
}

function proofObjectForIndex(index, state) {
  const method = methodologyFor(state?.brief?.deckType);
  const proof = method.proofObjects[index % method.proofObjects.length] || 'visual proof';
  const labels = {
    'market map': t('proofMarketMap'),
    'operating model': t('proofOperatingModel'),
    'risk bridge': t('proofRiskBridge'),
    'decision table': t('proofDecisionTable'),
    'before/after workflow': t('proofBeforeAfter'),
    'value bridge': t('proofValueBridge'),
    'customer proof': t('proofCustomerProof'),
    'implementation plan': t('proofImplementationPlan'),
    'metric bridge': t('proofMetricBridge'),
    'trend chart': t('proofTrendChart'),
    'variance table': t('proofVarianceTable'),
    'risk register': t('proofRiskRegister'),
    'concept map': t('proofConceptMap'),
    'worked example': t('proofWorkedExample'),
    comparison: t('proofComparison'),
    'practice prompt': t('proofPracticePrompt'),
    'market wedge': t('proofMarketWedge'),
    'product diagram': t('proofProductDiagram'),
    'traction chart': t('proofTractionChart'),
    'milestone plan': t('proofMilestonePlan'),
    'visual proof': t('proofVisualProof'),
  };
  return labels[proof] || proof;
}

function claimFor(title, index, state) {
  const topic = state?.brief?.topic || state?.title || title;
  if (index === 0) return t('claimCover', { topic });
  if (title && /[.!?。！？]$/.test(title.trim())) return title;
  const stems = [
    t('claimPressure', { title }),
    t('claimDecision', { title }),
    t('claimProof', { title }),
    t('claimAction', { title }),
  ];
  return stems[index % stems.length];
}

function supportNoteFor(title, index, state) {
  const proof = proofObjectForIndex(index, state);
  const material = state?.brief?.material?.trim();
  if (material) return t('supportWithSource', { proof });
  return t('supportWithAssumption', { proof });
}

function sourceNoteFor(state) {
  return state?.brief?.material?.trim() ? t('sourceUserMaterial') : t('sourceDraftAssumption');
}

function elementsForLayout(slide, index, total, state) {
  const title = slide.title;
  const points = pointsFor(title, index, state);
  if (slide.layout === 'cover') {
    return [
      { ...defaultElement('shape'), x: 6, y: 14, w: 5, h: 58, style: { ...defaultElement('shape').style, background: 'primary', opacity: 1, borderRadius: 99 } },
      { ...defaultElement('text'), text: title, x: 14, y: 20, w: 58, h: 20, style: { ...defaultElement('text').style, fontSize: 46, fontWeight: 840 } },
      { ...defaultElement('text'), text: slide.claim, x: 15, y: 48, w: 50, h: 14, style: { ...defaultElement('text').style, fontSize: 19, fontWeight: 540, color: 'muted' } },
      { ...defaultElement('metric'), text: String(total), label: t('slidesUnit'), x: 74, y: 52, w: 16, h: 19 },
    ];
  }
  if (slide.layout === 'closing') {
    return [
      { ...defaultElement('text'), text: title, x: 10, y: 16, w: 70, h: 16, style: { ...defaultElement('text').style, fontSize: 40, fontWeight: 820 } },
      { ...defaultElement('list'), items: [t('closeConfirm'), t('closeOwner'), t('closeIteration')], x: 12, y: 42, w: 50, h: 34, style: { ...defaultElement('list').style, fontSize: 22 } },
      { ...defaultElement('shape'), x: 70, y: 37, w: 20, h: 24, style: { ...defaultElement('shape').style, background: 'accent', opacity: 0.18, borderRadius: 20 } },
      { ...defaultElement('text'), text: slide.supportNote, x: 68, y: 45, w: 24, h: 18, style: { ...defaultElement('text').style, fontSize: 16, fontWeight: 620, color: 'muted' } },
    ];
  }
  if (slide.layout === 'metric') {
    return [
      { ...defaultElement('text'), text: title, x: 8, y: 13, w: 66, h: 14, style: { ...defaultElement('text').style, fontSize: 32, fontWeight: 810 } },
      { ...defaultElement('text'), text: slide.claim, x: 9, y: 30, w: 48, h: 10, style: { ...defaultElement('text').style, fontSize: 16, fontWeight: 540, color: 'muted' } },
      { ...defaultElement('metric'), text: '01', label: points[0], x: 9, y: 49, w: 24, h: 24 },
      { ...defaultElement('metric'), text: '02', label: points[1], x: 38, y: 49, w: 24, h: 24 },
      { ...defaultElement('metric'), text: '03', label: points[2], x: 67, y: 49, w: 24, h: 24 },
    ];
  }
  if (slide.layout === 'process') {
    return [
      { ...defaultElement('text'), text: title, x: 8, y: 13, w: 66, h: 14, style: { ...defaultElement('text').style, fontSize: 32, fontWeight: 810 } },
      { ...defaultElement('shape'), x: 10, y: 46, w: 78, h: 2, style: { ...defaultElement('shape').style, background: 'primary', opacity: 0.18, borderRadius: 99 } },
      ...points.map((point, pointIndex) => ({
        ...defaultElement('metric'),
        text: `0${pointIndex + 1}`,
        label: point,
        x: 10 + pointIndex * 27,
        y: 33,
        w: 22,
        h: 30,
        style: { ...defaultElement('metric').style, fontSize: 28 },
      })),
    ];
  }
  if (slide.layout === 'comparison') {
    return [
      { ...defaultElement('text'), text: title, x: 8, y: 12, w: 70, h: 13, style: { ...defaultElement('text').style, fontSize: 32, fontWeight: 810 } },
      { ...defaultElement('list'), items: points.slice(0, 2), x: 9, y: 36, w: 34, h: 34, style: { ...defaultElement('list').style, background: 'panel', borderRadius: 14 } },
      { ...defaultElement('chart'), text: slide.proofObject, x: 53, y: 34, w: 36, h: 36 },
    ];
  }
  return [
    { ...defaultElement('text'), text: title, x: 8, y: 12, w: 62, h: 14, style: { ...defaultElement('text').style, fontSize: 32, fontWeight: 810 } },
    { ...defaultElement('list'), items: points, x: 9, y: 34, w: 44, h: 38 },
    { ...defaultElement('text'), text: slide.supportNote, x: 61, y: 35, w: 28, h: 28, style: { ...defaultElement('text').style, fontSize: 18, fontWeight: 600, color: 'primary', background: 'soft', borderRadius: 16 } },
  ];
}

function pointsFor(title, index, state) {
  const topic = state?.brief?.topic || title;
  const proof = proofObjectForIndex(index, state);
  const pool = [
    `${t('pointClaimPrefix')} ${claimFor(title, index, state)}`,
    `${t('pointProofPrefix')} ${proof}`,
    `${t('pointAudiencePrefix')} ${topic}`,
    t('pointEvidenceRule'),
    t('pointDesignRule'),
    t('pointCloseRule'),
  ];
  return [pool[index % pool.length], pool[(index + 1) % pool.length], pool[(index + 2) % pool.length]];
}
