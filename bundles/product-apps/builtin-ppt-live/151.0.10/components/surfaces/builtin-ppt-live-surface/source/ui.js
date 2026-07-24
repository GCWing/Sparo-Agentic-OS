const state = {
  snapshot: null,
  selectedSlideId: null,
  selectedNodeId: null,
  activeView: 'visual',
  zoom: 1,
  busy: false,
  designPanelOpen: false,
  toastTimer: null,
  refreshTimer: null,
  assetData: new Map(),
  assetLoads: new Map(),
  followGeneration: true,
  userNavigated: false,
  colorDraft: null,
  colorDraftRevision: null,
  invalidColorTokens: new Set(),
  nodeInteraction: null,
  wheelNavigation: { accumulated: 0, direction: 0, lastEventAt: 0 },
  documentEditor: { view: null, key: null },
  documents: {
    manuscript: {
      documentId: 'manuscript', fileName: '内容.md', content: '', savedContent: '', revision: 0, hash: '', dirty: false, stale: true,
    },
    speaker: {
      documentId: 'speakerScript', fileName: '演讲稿.md', content: '', savedContent: '', revision: 0, hash: '', dirty: false, stale: true,
    },
  },
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const SLIDE_RENDER_WIDTH = 960;
const SLIDE_RENDER_HEIGHT = 540;
const SLIDE_WHEEL_DISTANCE = 100;
const WHEEL_NAVIGATION_IDLE_MS = 320;
const COLOR_TOKEN_GROUPS = [
  { labelKey: 'design.paletteFoundation', tokens: ['canvas', 'surface', 'ink', 'muted', 'border', 'primary', 'accent'] },
  { labelKey: 'design.paletteStates', tokens: ['positive', 'caution', 'negative'] },
];

function runtime() {
  return window.app || {};
}

function t(key, params, fallback) {
  const translate = runtime().i18n?.t;
  return typeof translate === 'function' ? translate(key, params, fallback) : (fallback ?? key);
}

function localizedPresetValue(system, field, fallback) {
  if (!system?.systemId) return fallback;
  return t(`presets.${system.systemId}.${field}`, undefined, fallback);
}

function semanticLabel(group, value) {
  const key = String(value ?? '').replace(/\./g, '_');
  return t(`${group}.${key}`, undefined, value);
}

function applyStaticTexts() {
  document.title = t('meta.title', undefined, 'PPT Live');
  document.documentElement.lang = runtime().i18n?.locale || runtime().locale || 'en-US';
  $$('[data-i18n]').forEach((node) => {
    node.textContent = t(node.dataset.i18n, undefined, node.textContent);
  });
  [
    ['i18nAriaLabel', 'aria-label'],
    ['i18nTitle', 'title'],
    ['i18nPlaceholder', 'placeholder'],
  ].forEach(([dataKey, attribute]) => {
    $$(`[data-${dataKey.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}]`).forEach((node) => {
      node.setAttribute(attribute, t(node.dataset[dataKey], undefined, node.getAttribute(attribute)));
    });
  });
}

function renderLocalizedUi() {
  applyStaticTexts();
  updateFollowGenerationUi();
  if (!state.snapshot) return;
  renderThumbs();
  renderCanvas();
  renderDesignCasePanel();
  updateHeader();
  updateWorkspaceContext();
  if (state.activeView === 'manuscript' || state.activeView === 'speaker') {
    updateDocumentUi(state.activeView);
  }
}

function bridgeOutput(result) {
  if (result?.bridgeResult?.output !== undefined) return result.bridgeResult.output;
  if (result?.output !== undefined) return result.output;
  return result;
}

function uid(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

async function callDeck(action, input = {}) {
  const app = runtime();
  if (!app.backend?.call) {
    throw new Error(t('errors.deckUnavailable', undefined, 'Deck Engine is unavailable for this session'));
  }
  const result = await app.backend.call(`deckEngine.${action}`, input, {
    idempotencyKey: uid(`ppt-${action}`),
  });
  if (result?.status === 'failed' || result?.bridgeResult?.status === 'failed') {
    throw new Error(
      result?.message
      || result?.bridgeResult?.stderr
      || t('errors.actionFailed', { action }, `${action} failed`),
    );
  }
  return bridgeOutput(result);
}

async function submitChatIntent(intent) {
  const app = runtime();
  if (!app.host?.submitChatIntent) {
    throw new Error(t(
      'errors.flowChatDisconnected',
      undefined,
      'This presentation is not connected to its FlowChat session',
    ));
  }
  await app.host.submitChatIntent(intent);
}

function showToast(message, isError = false) {
  const toast = $('#toast');
  clearTimeout(state.toastTimer);
  toast.textContent = String(message || '');
  toast.classList.toggle('is-error', isError);
  toast.hidden = false;
  state.toastTimer = setTimeout(() => {
    toast.hidden = true;
  }, isError ? 5200 : 3400);
}

function setBusy(value) {
  state.busy = value;
  $('#undoButton').disabled = value || !state.snapshot?.canUndo;
  updateExportButton();
  updateDesignPromptUi();
  $('#designPrompt').disabled = value;
  $$('[data-design-prompt-key]').forEach((button) => { button.disabled = value; });
  updateColorEditorUi();
  updateDocumentUi('manuscript');
  updateDocumentUi('speaker');
}

function canonicalSystem() {
  return state.snapshot?.presentationSystem || null;
}

function tokenColor(system, token) {
  if (!system) return '';
  if (String(token).startsWith('data.')) {
    return system.color.dataSeries[Number(String(token).slice(5)) - 1]?.value || '';
  }
  return system.color[token]?.value || '';
}

function colorTokens(system) {
  return [
    ...COLOR_TOKEN_GROUPS.flatMap((group) => group.tokens),
    ...(system?.color?.dataSeries || []).map((_entry, index) => `data.${index + 1}`),
  ];
}

function ensureColorDraft(system = canonicalSystem()) {
  if (!system) return;
  if (state.colorDraftRevision === system.revision && state.colorDraft) return;
  state.colorDraft = Object.fromEntries(
    colorTokens(system).map((token) => [token, tokenColor(system, token).toUpperCase()]),
  );
  state.colorDraftRevision = system.revision;
  state.invalidColorTokens.clear();
}

function hasColorDraftChanges(system = canonicalSystem()) {
  if (!system || !state.colorDraft || state.colorDraftRevision !== system.revision) return false;
  return colorTokens(system).some((token) => (
    state.colorDraft[token]?.toUpperCase() !== tokenColor(system, token).toUpperCase()
  ));
}

function activeSystem() {
  const system = canonicalSystem();
  if (!system || !state.colorDraft || state.colorDraftRevision !== system.revision) return system;
  const color = { ...system.color };
  for (const token of COLOR_TOKEN_GROUPS.flatMap((group) => group.tokens)) {
    color[token] = { ...system.color[token], value: state.colorDraft[token] || system.color[token].value };
  }
  color.dataSeries = system.color.dataSeries.map((entry, index) => ({
    ...entry,
    value: state.colorDraft[`data.${index + 1}`] || entry.value,
  }));
  return { ...system, color };
}

function systemColor(token = 'ink', system = activeSystem()) {
  if (token === 'transparent') return 'transparent';
  if (String(token).startsWith('data.')) return system.color.dataSeries[Number(String(token).slice(5)) - 1]?.value || system.color.primary.value;
  return system.color[token]?.value || system.color.ink.value;
}

function typeRole(role = 'body', system = activeSystem()) {
  const resolved = system.typography.roles[role] || system.typography.roles.body;
  const familyName = resolved.family === 'display'
    ? system.typography.displayFamily
    : resolved.family === 'mono'
      ? system.typography.monoFamily
      : system.typography.bodyFamily;
  return { ...resolved, familyName };
}

function selectedSlide() {
  const slides = state.snapshot?.deck?.slides || [];
  if (state.selectedSlideId) return slides.find((slide) => slide.id === state.selectedSlideId) || null;
  return slides[0] || null;
}

function plannedSlides() {
  const progress = state.snapshot?.productionProgress;
  if (progress?.length) {
    const manuscriptById = new Map((state.snapshot?.manuscript?.slides || []).map((slide) => [slide.slideId, slide]));
    const visualById = new Map((state.snapshot?.deck?.slides || []).map((slide) => [slide.id, slide]));
    return progress.map((item) => {
      const source = manuscriptById.get(item.slideId) || {};
      const visual = visualById.get(item.slideId);
      return {
        title: visual?.title || source.title,
        claim: visual?.claim || source.coreClaim,
        pageRole: visual?.pageRole || source.visualDirection?.pageRole,
        recipeId: visual?.recipeId || source.visualDirection?.recipe,
        ...item,
      };
    });
  }
  const deck = state.snapshot?.deck;
  return (deck?.slides || []).map((slide, index) => ({
    slideId: slide.id,
    position: index + 1,
    title: slide.title,
    claim: slide.claim,
    pageRole: slide.pageRole,
    recipeId: slide.recipeId || 'legacy-freeform',
    status: slide.status || 'previewReady',
    slideRevision: slide.revision || 0,
  }));
}

function selectedPlanItem() {
  const plan = plannedSlides();
  return plan.find((item) => item.slideId === state.selectedSlideId) || plan[0] || null;
}

function hasBlockingDiagnostics() {
  return (state.snapshot?.ruleViolations || []).length > 0;
}

function hasPassedCurrentReview() {
  const review = state.snapshot?.latestReview;
  const deck = state.snapshot?.deck;
  const system = state.snapshot?.presentationSystem;
  return review?.status === 'passed'
    && review.deckRevision === deck?.revision
    && review.systemRevision === system?.revision
    && review.systemHash === system?.contentHash
    && review.manuscriptRevision === state.snapshot?.manuscript?.revision
    && review.manuscriptHash === state.snapshot?.manuscript?.contentHash
    && review.speakerScriptRevision === state.snapshot?.manuscript?.speakerScriptRevision
    && review.speakerScriptHash === state.snapshot?.manuscript?.speakerScriptHash
    && Boolean(review.reviewCoverage);
}

function updateExportButton() {
  const deck = state.snapshot?.deck;
  const pendingColors = hasColorDraftChanges();
  const exportButton = $('#exportButton');
  if (!exportButton) return;
  exportButton.disabled = state.busy
    || pendingColors
    || !(deck?.slides?.length > 0)
    || hasBlockingDiagnostics()
    || !hasPassedCurrentReview();
  const exportLabel = pendingColors
    ? t('actions.exportColorsPending', undefined, 'Apply or reset color edits before export')
    : hasPassedCurrentReview()
      ? t('actions.exportReviewed', undefined, 'Export reviewed PowerPoint')
      : t('actions.exportReviewRequired', undefined, 'Run and pass presentation review before export');
  exportButton.title = exportLabel;
  exportButton.setAttribute('aria-label', exportLabel);
}

function updateHeader() {
  const deck = state.snapshot?.deck;
  const system = activeSystem();
  $('#deckTitle').textContent = deck?.title || t('header.untitled', undefined, 'Untitled presentation');
  const plan = plannedSlides();
  const generationActive = plan.some((item) => item.status === 'generating');
  const deckStatus = hasPassedCurrentReview()
    ? t('header.readyToExport', undefined, 'Ready to export')
    : generationActive
      ? t('header.generating', undefined, 'Generating')
      : t('header.needsReview', undefined, 'Review pending');
  $('#deckMeta').textContent = t(
    'header.deckMeta',
    { count: plan.length, status: deckStatus },
    `${plan.length} slides · ${deckStatus}`,
  );
  $('#currentStyleName').textContent = localizedPresetValue(
    system,
    'name',
    system.name || t('style.defaultName', undefined, 'Presentation system'),
  );
  $('#headerStyleName').textContent = localizedPresetValue(system, 'name', system.name);
  $('#undoButton').disabled = state.busy || !state.snapshot?.canUndo;
  updateExportButton();
  renderSystem();
  updateWorkspaceContext();
}

function updateWorkspaceContext() {
  const plan = plannedSlides();
  const current = selectedPlanItem();
  const index = current ? plan.findIndex((item) => item.slideId === current.slideId) : -1;
  $('#speakerSlideTitle').textContent = current?.title
    || t('speaker.noSlide', undefined, 'Select a slide to prepare its delivery');
  $('#speakerSlideMeta').textContent = current
    ? t(
      'speaker.slideMeta',
      { current: index + 1, total: plan.length },
      `Slide ${index + 1} of ${plan.length} · Speaker script is a separate Markdown document`,
    )
    : t(
      'speaker.separateDocument',
      undefined,
      'Speaker script is edited as a substantial Markdown document',
    );
  const speakerOpen = state.activeView === 'speaker';
  $('#speakerButton').setAttribute('aria-pressed', String(speakerOpen));
  $('#speakerButtonLabel').textContent = speakerOpen
    ? t('actions.backToSlides', undefined, 'Back to slides')
    : t('actions.openSpeakerScript', undefined, 'Open speaker script');
  $('#manuscriptButton').setAttribute('aria-pressed', String(state.activeView === 'manuscript'));
}

function setDesignPanel(open) {
  const next = Boolean(open);
  if (next && state.activeView !== 'visual') selectView('visual');
  state.designPanelOpen = next;
  $('#pptLiveRoot').dataset.designOpen = String(next);
  $('#systemView').hidden = !next;
  $('#designButton').setAttribute('aria-expanded', String(next));
  if (next && state.snapshot) renderSystem();
  requestAnimationFrame(() => syncSlideRenderLayers());
}

function updateFollowGenerationUi() {
  const button = $('#followGeneration');
  if (!button) return;
  button.classList.toggle('is-active', state.followGeneration);
  button.setAttribute('aria-pressed', String(state.followGeneration));
  button.textContent = state.followGeneration
    ? t('actions.followingGeneration', undefined, 'Following generation')
    : t('actions.followGeneration', undefined, 'Follow generation');
}

function renderThumbs() {
  const host = $('#slideThumbs');
  const slides = state.snapshot?.deck?.slides || [];
  const slidesById = new Map(slides.map((slide) => [slide.id, slide]));
  const plan = plannedSlides();
  const system = activeSystem();
  host.replaceChildren();
  plan.forEach((item, index) => {
    const slide = slidesById.get(item.slideId);
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `slide-thumb slide-thumb--${item.status || 'planned'}${item.slideId === state.selectedSlideId ? ' is-active' : ''}`;
    button.setAttribute('aria-label', t(
      'visual.slideThumb',
      { number: index + 1, title: item.title, status: statusLabel(item.status) },
      `Slide ${index + 1}: ${item.title}, ${statusLabel(item.status)}`,
    ));
    if (item.slideId === state.selectedSlideId) button.setAttribute('aria-current', 'true');
    const number = document.createElement('span');
    number.className = 'slide-thumb__index';
    number.textContent = String(index + 1);
    const frame = document.createElement('span');
    frame.className = 'slide-thumb__frame';
    frame.style.setProperty('--thumb-bg', systemColor('canvas', system));
    if (!slide?.renderTree?.nodes?.length) {
      const placeholder = document.createElement('span');
      placeholder.className = 'slide-thumb__placeholder';
      const recipe = document.createElement('span');
      recipe.className = 'slide-thumb__recipe';
      recipe.textContent = item.recipeId || item.pageRole || 'planned';
      const title = document.createElement('strong');
      title.textContent = item.title;
      const status = document.createElement('span');
      status.className = 'slide-thumb__status';
      status.textContent = statusLabel(item.status);
      placeholder.append(recipe, title, status);
      frame.append(placeholder);
    }
    const statusDot = document.createElement('i');
    statusDot.className = 'slide-thumb__status-dot';
    statusDot.setAttribute('aria-hidden', 'true');
    number.append(statusDot);
    button.append(number, frame);
    button.addEventListener('click', () => selectSlide(item.slideId, false, true));
    host.append(button);
    if (slide?.renderTree?.nodes?.length) {
      ensureSlideAssets(slide);
      const renderLayer = createSlideRenderLayer(frame);
      slide.renderTree.nodes.forEach((node) => renderLayer.append(renderCompiledNode(node)));
    }
  });
}

function statusLabel(status) {
  const normalized = Object.prototype.hasOwnProperty.call({
    planned: true,
    generating: true,
    previewReady: true,
    reviewing: true,
    needsFix: true,
    approved: true,
    stale: true,
    failed: true,
  }, status) ? status : 'planned';
  const fallback = {
    planned: 'Waiting',
    generating: 'Generating',
    previewReady: 'Preview ready',
    reviewing: 'Reviewing',
    needsFix: 'Needs fix',
    approved: 'Approved',
    stale: 'Needs update',
    failed: 'Generation failed',
  }[normalized];
  return t(`status.${normalized}`, undefined, fallback);
}

function setElementBox(node, element) {
  node.style.left = `${Number(element.x) || 0}%`;
  node.style.top = `${Number(element.y) || 0}%`;
  node.style.width = `${Number(element.w) || 0}%`;
  node.style.height = `${Number(element.h) || 0}%`;
  node.style.zIndex = String(Number(element.z) || 0);
}

function fitSlideRenderLayer(host, layer) {
  const hostWidth = host.clientWidth;
  const hostHeight = host.clientHeight;
  if (!hostWidth || !hostHeight) return;
  const scale = Math.min(hostWidth / SLIDE_RENDER_WIDTH, hostHeight / SLIDE_RENDER_HEIGHT);
  const offsetX = (hostWidth - SLIDE_RENDER_WIDTH * scale) / 2;
  const offsetY = (hostHeight - SLIDE_RENDER_HEIGHT * scale) / 2;
  layer.style.setProperty('--slide-fit-scale', String(scale));
  layer.style.setProperty('--slide-fit-x', `${offsetX}px`);
  layer.style.setProperty('--slide-fit-y', `${offsetY}px`);
}

function createSlideRenderLayer(host) {
  const layer = document.createElement('span');
  layer.className = 'slide-render-layer';
  host.append(layer);
  fitSlideRenderLayer(host, layer);
  return layer;
}

function syncSlideRenderLayers() {
  $$('.slide-render-layer').forEach((layer) => {
    const host = layer.parentElement;
    if (host) fitSlideRenderLayer(host, layer);
  });
}

function solveGroupChildren(group) {
  const children = group.children || [];
  const layout = group.layout || { mode: 'freeform' };
  if (layout.mode === 'freeform' || layout.mode === 'overlay' || !children.length) return children;
  const padding = Number(layout.padding || 0);
  const gap = Number(layout.gap || 0);
  const innerW = Math.max(0.1, 100 - padding * 2);
  const innerH = Math.max(0.1, 100 - padding * 2);
  if (layout.mode === 'stack') {
    const height = Math.max(0.1, (innerH - gap * (children.length - 1)) / children.length);
    return children.map((child, index) => ({ ...child, x: padding, y: padding + index * (height + gap), w: innerW, h: height }));
  }
  if (layout.mode === 'row') {
    const width = Math.max(0.1, (innerW - gap * (children.length - 1)) / children.length);
    return children.map((child, index) => ({ ...child, x: padding + index * (width + gap), y: padding, w: width, h: innerH }));
  }
  const columns = Math.min(children.length, Math.max(1, Math.round(layout.columns || Math.ceil(Math.sqrt(children.length)))));
  const rows = Math.ceil(children.length / columns);
  const width = Math.max(0.1, (innerW - gap * (columns - 1)) / columns);
  const height = Math.max(0.1, (innerH - gap * (rows - 1)) / rows);
  return children.map((child, index) => ({ ...child, x: padding + (index % columns) * (width + gap), y: padding + Math.floor(index / columns) * (height + gap), w: width, h: height }));
}

function renderElement(element, system) {
  let node;
  if (element.type === 'group') {
    node = document.createElement('div');
    [...solveGroupChildren(element)]
      .sort((left, right) => Number(left.z || 0) - Number(right.z || 0))
      .forEach((child) => node.append(renderElement(child, system)));
  } else if (element.type === 'shape') {
    node = document.createElement('div');
    node.dataset.shape = element.shape || 'rect';
    node.textContent = element.text || '';
  } else if (element.type === 'line') {
    node = document.createElement('div');
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 100 100');
    svg.setAttribute('preserveAspectRatio', 'none');
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', '0');
    line.setAttribute('y1', '0');
    line.setAttribute('x2', '100');
    line.setAttribute('y2', '100');
    line.setAttribute('stroke', systemColor(element.style?.strokeToken || 'primary', system));
    line.setAttribute('stroke-width', String(Number(element.style?.strokeWidth) || 2));
    svg.append(line);
    node.append(svg);
  } else if (element.type === 'image' || element.type === 'svg') {
    node = document.createElement('div');
    const image = document.createElement('img');
    image.alt = element.alt || '';
    const dataUri = state.assetData.get(element.assetId);
    if (dataUri) image.src = dataUri;
    node.append(image);
  } else if (element.type === 'chart') {
    node = document.createElement('div');
    const title = document.createElement('span');
    title.className = 'chart-title';
    title.textContent = element.text || '';
    const bars = document.createElement('div');
    bars.className = 'chart-bars';
    const values = (element.data || []).map((point) => Number(point.value) || 0);
    const max = Math.max(1, ...values);
    (element.data || []).forEach((point, index) => {
      const bar = document.createElement('i');
      bar.className = 'chart-bar';
      bar.style.setProperty('--bar-height', `${Math.max(8, (Number(point.value) || 0) / max * 100)}%`);
      const series = system.chart.seriesTokens[index % system.chart.seriesTokens.length];
      bar.style.setProperty('--bar-color', systemColor(series, system));
      const label = document.createElement('span');
      label.textContent = point.label || '';
      bar.append(label);
      bars.append(bar);
    });
    node.append(title, bars);
  } else if (element.type === 'table') {
    node = document.createElement('table');
    (element.rows || []).forEach((row, rowIndex) => {
      const tr = document.createElement('tr');
      row.forEach((cell) => {
        const item = document.createElement(rowIndex === 0 ? 'th' : 'td');
        item.textContent = cell;
        tr.append(item);
      });
      node.append(tr);
    });
  } else {
    node = document.createElement('div');
    node.textContent = element.text || '';
  }
  node.className = `slide-element slide-element--${element.type || 'text'}`;
  setElementBox(node, element);
  const style = element.style || {};
  const role = typeRole(style.textRole || (element.type === 'shape' ? 'label' : 'body'), system);
  node.style.setProperty('--element-color', systemColor(style.colorToken || 'ink', system));
  node.style.setProperty('--element-font-size', `${Number(role.size) || 18}px`);
  node.style.setProperty('--element-font-weight', String(role.weight));
  node.style.setProperty('--element-font-family', role.familyName);
  node.style.setProperty('--element-line-height', String(role.lineHeight));
  node.style.setProperty('--element-align', style.align || 'left');
  node.style.setProperty('--element-background', systemColor(style.fillToken || 'transparent', system));
  node.style.setProperty('--element-stroke', systemColor(style.strokeToken || system.shape.borderToken, system));
  node.style.setProperty('--element-stroke-width', `${Number(style.strokeWidth ?? system.shape.strokeWidth)}px`);
  node.style.setProperty('--element-radius', `${Number(system.shape.radius[style.radiusRole || 'none'])}px`);
  if (style.opacity != null) node.style.opacity = String(style.opacity);
  return node;
}

function renderCompiledNode(compiled, editable = false) {
  const system = activeSystem();
  const node = document.createElement(compiled.type === 'table' ? 'table' : 'div');
  if (compiled.type === 'shape') {
    node.dataset.shape = compiled.shape || 'rect';
    node.textContent = compiled.text || '';
  } else if (compiled.type === 'line') {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 100 100');
    svg.setAttribute('preserveAspectRatio', 'none');
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', '0');
    line.setAttribute('y1', '0');
    line.setAttribute('x2', '100');
    line.setAttribute('y2', '100');
    line.setAttribute('stroke', system && compiled.style?.tokens?.stroke
      ? systemColor(compiled.style.tokens.stroke, system)
      : compiled.style.stroke);
    line.setAttribute('stroke-width', String(compiled.style.strokeWidth || 1));
    if (compiled.style.dash === 'dash') line.setAttribute('stroke-dasharray', '8 6');
    if (compiled.style.dash === 'dot') line.setAttribute('stroke-dasharray', '2 5');
    svg.append(line);
    node.append(svg);
  } else if (compiled.type === 'image' || compiled.type === 'svg') {
    const image = document.createElement('img');
    image.alt = compiled.alt || '';
    image.style.objectFit = compiled.fit || 'contain';
    const dataUri = state.assetData.get(compiled.assetId);
    if (dataUri) image.src = dataUri;
    node.append(image);
  } else if (compiled.type === 'chart') {
    const title = document.createElement('span');
    title.className = 'chart-title';
    title.textContent = compiled.text || '';
    const bars = document.createElement('div');
    bars.className = 'chart-bars';
    const values = (compiled.data || []).map((point) => Math.abs(Number(point.value) || 0));
    const max = Math.max(1, ...values);
    (compiled.data || []).forEach((point, index) => {
      const bar = document.createElement('i');
      bar.className = 'chart-bar';
      bar.style.setProperty('--bar-height', `${Math.max(8, Math.abs(Number(point.value) || 0) / max * 100)}%`);
      const seriesToken = system?.chart?.seriesTokens?.[index % system.chart.seriesTokens.length];
      bar.style.setProperty('--bar-color', seriesToken ? systemColor(seriesToken, system) : compiled.seriesColors?.[index % compiled.seriesColors.length] || compiled.style.color);
      const label = document.createElement('span');
      label.textContent = point.label || '';
      bar.append(label);
      bars.append(bar);
    });
    node.append(title, bars);
  } else if (compiled.type === 'table') {
    (compiled.rows || []).forEach((row, rowIndex) => {
      const tr = document.createElement('tr');
      row.forEach((cell) => {
        const item = document.createElement(rowIndex === 0 ? 'th' : 'td');
        item.textContent = cell;
        tr.append(item);
      });
      node.append(tr);
    });
  } else {
    node.textContent = compiled.text || '';
  }
  node.className = `slide-element slide-element--${compiled.type || 'text'}`;
  setElementBox(node, { ...compiled.box, z: compiled.z });
  const style = compiled.style || {};
  const tokens = style.tokens || {};
  node.style.setProperty('--element-color', system && tokens.color ? systemColor(tokens.color, system) : style.color || 'currentColor');
  node.style.setProperty('--element-font-size', `${Number(style.fontSize) || 18}px`);
  node.style.setProperty('--element-font-weight', String(style.fontWeight || 400));
  node.style.setProperty('--element-font-family', style.fontFamily || 'inherit');
  node.style.setProperty('--element-line-height', String(style.lineHeight || 1.2));
  node.style.setProperty('--element-align', style.align || 'left');
  node.style.setProperty('--element-background', system && tokens.fill ? systemColor(tokens.fill, system) : style.fill || 'transparent');
  node.style.setProperty('--element-stroke', system && tokens.stroke ? systemColor(tokens.stroke, system) : style.stroke || 'transparent');
  node.style.setProperty('--element-stroke-width', `${Number(style.strokeWidth || 0)}px`);
  node.style.setProperty('--element-radius', `${Number(style.radius || 0)}px`);
  node.style.setProperty('--element-padding', `${Number(style.padding || 0)}%`);
  node.dataset.valign = style.valign || 'top';
  if (style.opacity != null) node.style.opacity = String(style.opacity);
  if (editable) decorateEditableNode(node, compiled);
  return node;
}

function selectedRenderNode() {
  return selectedSlide()?.renderTree?.nodes?.find((node) => node.id === state.selectedNodeId) || null;
}

function selectVisualNode(nodeId) {
  state.selectedNodeId = nodeId;
  $('#slideCanvas')?.classList.toggle('has-selection', Boolean(nodeId));
  $$('#slideCanvas .slide-element').forEach((element) => {
    const selected = element.dataset.nodeId === nodeId;
    element.classList.toggle('is-selected', selected);
    element.setAttribute('aria-selected', String(selected));
  });
}

function snapPercent(value) {
  return Math.round(Number(value) * 2) / 2;
}

function canvasSafeArea() {
  const safeArea = activeSystem()?.layout?.safeArea || {};
  return {
    top: Number(safeArea.top || 0),
    right: Number(safeArea.right || 0),
    bottom: Number(safeArea.bottom || 0),
    left: Number(safeArea.left || 0),
  };
}

async function commitNodeEdit(nodeId, nodePatch) {
  const slide = selectedSlide();
  if (!slide || state.busy) return;
  setBusy(true);
  try {
    const output = await callDeck('editVisual', {
      expectedRevision: state.snapshot.deck.revision,
      expectedSlideRevision: slide.revision,
      expectedVisualRevision: slide.visualRevision,
      operation: 'updateNode',
      slideId: slide.id,
      nodeId,
      nodePatch,
      intent: 'Direct user edit on the canonical VisualDocument canvas',
    });
    state.snapshot = { ...state.snapshot, ...output };
    state.selectedNodeId = nodeId;
    renderThumbs();
    renderCanvas();
    updateHeader();
    showToast(t('toasts.objectUpdated', undefined, 'Visual object updated'));
  } catch (error) {
    showToast(error.message || String(error), true);
    await refreshSnapshot().catch(() => {});
  } finally {
    setBusy(false);
  }
}

function startNodeInteraction(event, element, compiled, handle = null) {
  if (state.busy || compiled.locked || element.isContentEditable) return;
  event.preventDefault();
  event.stopPropagation();
  selectVisualNode(compiled.id);
  const canvas = $('#slideCanvas');
  const canvasRect = canvas.getBoundingClientRect();
  const original = { ...compiled.box };
  const safeArea = canvasSafeArea();
  const maxRight = 100 - safeArea.right;
  const maxBottom = 100 - safeArea.bottom;
  const pointerId = event.pointerId;
  element.setPointerCapture?.(pointerId);
  state.nodeInteraction = { nodeId: compiled.id, handle, original };

  const move = (moveEvent) => {
    const dx = (moveEvent.clientX - event.clientX) / canvasRect.width * 100;
    const dy = (moveEvent.clientY - event.clientY) / canvasRect.height * 100;
    const next = { ...original };
    if (!handle) {
      next.x = snapPercent(Math.min(maxRight - original.w, Math.max(safeArea.left, original.x + dx)));
      next.y = snapPercent(Math.min(maxBottom - original.h, Math.max(safeArea.top, original.y + dy)));
    } else {
      if (handle.includes('e')) next.w = snapPercent(Math.max(2, Math.min(maxRight - original.x, original.w + dx)));
      if (handle.includes('s')) next.h = snapPercent(Math.max(2, Math.min(maxBottom - original.y, original.h + dy)));
      if (handle.includes('w')) {
        next.x = snapPercent(Math.max(safeArea.left, Math.min(original.x + original.w - 2, original.x + dx)));
        next.w = snapPercent(original.w + original.x - next.x);
      }
      if (handle.includes('n')) {
        next.y = snapPercent(Math.max(safeArea.top, Math.min(original.y + original.h - 2, original.y + dy)));
        next.h = snapPercent(original.h + original.y - next.y);
      }
    }
    setElementBox(element, { ...next, z: compiled.z });
    state.nodeInteraction.previewBox = next;
  };

  const finish = () => {
    element.removeEventListener('pointermove', move);
    element.removeEventListener('pointerup', finish);
    element.removeEventListener('pointercancel', finish);
    element.releasePointerCapture?.(pointerId);
    const previewBox = state.nodeInteraction?.previewBox;
    state.nodeInteraction = null;
    if (previewBox && JSON.stringify(previewBox) !== JSON.stringify(original)) {
      void commitNodeEdit(compiled.id, { box: previewBox });
    }
  };
  element.addEventListener('pointermove', move);
  element.addEventListener('pointerup', finish);
  element.addEventListener('pointercancel', finish);
}

function decorateEditableNode(element, compiled) {
  element.dataset.nodeId = compiled.id;
  element.dataset.nodeType = compiled.type;
  element.tabIndex = 0;
  element.setAttribute('role', 'button');
  const role = compiled.semanticRole || compiled.type;
  const description = compiled.text ? `: ${compiled.text}` : '';
  element.setAttribute('aria-label', t(
    'visual.object',
    { role, description },
    `${role} object${description}`,
  ));
  element.classList.toggle('is-selected', state.selectedNodeId === compiled.id);
  element.setAttribute('aria-selected', String(state.selectedNodeId === compiled.id));
  element.addEventListener('pointerdown', (event) => {
    const handle = event.target.closest?.('.node-resize-handle')?.dataset.handle || null;
    startNodeInteraction(event, element, compiled, handle);
  });
  element.addEventListener('keydown', (event) => {
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
    event.preventDefault();
    const step = event.shiftKey ? 2 : 0.5;
    const box = { ...compiled.box };
    const safeArea = canvasSafeArea();
    if (event.key === 'ArrowLeft') box.x = Math.max(safeArea.left, box.x - step);
    if (event.key === 'ArrowRight') box.x = Math.min(100 - safeArea.right - box.w, box.x + step);
    if (event.key === 'ArrowUp') box.y = Math.max(safeArea.top, box.y - step);
    if (event.key === 'ArrowDown') box.y = Math.min(100 - safeArea.bottom - box.h, box.y + step);
    void commitNodeEdit(compiled.id, { box });
  });
  ['nw', 'ne', 'sw', 'se'].forEach((handle) => {
    const control = document.createElement('span');
    control.className = `node-resize-handle is-${handle}`;
    control.dataset.handle = handle;
    control.setAttribute('aria-hidden', 'true');
    element.append(control);
  });
}

function ensureSlideAssets(slide) {
  const collect = (elements) => elements.flatMap((element) => (
    element.type === 'group'
      ? collect(element.children || [])
      : element.type === 'image' || element.type === 'svg'
        ? [element.assetId]
        : []
  ));
  const elements = slide?.renderTree?.nodes || slide?.elements || [];
  for (const assetId of new Set(collect(elements))) {
    if (!assetId || state.assetData.has(assetId) || state.assetLoads.has(assetId)) continue;
    const load = callDeck('getAsset', { assetId })
      .then((output) => {
        state.assetData.set(assetId, output.asset.dataUri);
        renderThumbs();
        if (selectedSlide()?.id === slide.id) renderCanvas();
      })
      .catch((error) => showToast(error.message || String(error), true))
      .finally(() => state.assetLoads.delete(assetId));
    state.assetLoads.set(assetId, load);
  }
}

function applyCanvasSystem(canvas, system) {
  canvas.style.setProperty('--slide-bg', systemColor('canvas', system));
  canvas.style.setProperty('--slide-ink', systemColor('ink', system));
  canvas.style.setProperty('--slide-muted', systemColor('muted', system));
  canvas.style.setProperty('--slide-primary', systemColor('primary', system));
  canvas.style.setProperty('--slide-accent', systemColor('accent', system));
  canvas.style.setProperty('--slide-panel', systemColor('surface', system));
}

function renderCanvas() {
  const canvas = $('#slideCanvas');
  const slides = state.snapshot?.deck?.slides || [];
  const plan = plannedSlides();
  const slide = selectedSlide();
  const planItem = selectedPlanItem();
  const index = planItem ? plan.findIndex((candidate) => candidate.slideId === planItem.slideId) : -1;
  const system = activeSystem();
  $('#visualView').classList.toggle('is-empty', plan.length === 0);
  canvas.style.setProperty('--canvas-zoom', String(state.zoom));
  if (!system) {
    canvas.className = 'slide-canvas is-empty';
    canvas.replaceChildren();
    $('#slidePosition').textContent = '0 / 0';
    $('#visualInspector').hidden = true;
    return;
  }
  applyCanvasSystem(canvas, system);
  $('#zoomValue').textContent = `${Math.round(state.zoom * 100)}%`;
  $('#slidePosition').textContent = planItem ? `${index + 1} / ${plan.length}` : '0 / 0';
  if (!planItem) {
    canvas.className = 'slide-canvas is-empty';
    renderEmptyCanvas(canvas, system);
    $('#visualInspector').hidden = true;
    return;
  }

  if (!slide) {
    state.selectedNodeId = null;
    canvas.className = `slide-canvas is-planned is-${planItem.status || 'planned'}`;
    renderPlannedCanvas(canvas, planItem, system);
    $('#visualInspector').hidden = true;
    return;
  }

  canvas.className = 'slide-canvas';
  canvas.replaceChildren();

  if (!slide.renderTree?.nodes?.some((node) => node.id === state.selectedNodeId)) {
    state.selectedNodeId = null;
  }
  canvas.classList.toggle('has-selection', Boolean(state.selectedNodeId));

  const safeArea = canvasSafeArea();
  const renderLayer = createSlideRenderLayer(canvas);
  const guide = document.createElement('div');
  guide.className = 'canvas-safe-area';
  guide.style.inset = `${safeArea.top}% ${safeArea.right}% ${safeArea.bottom}% ${safeArea.left}%`;
  guide.setAttribute('aria-hidden', 'true');
  renderLayer.append(guide);

  ensureSlideAssets(slide);
  (slide.renderTree?.nodes || [])
    .forEach((node) => renderLayer.append(renderCompiledNode(node, true)));
  renderVisualInspector(slide, index);
}

function renderEmptyCanvas(canvas, system) {
  const empty = document.createElement('div');
  empty.className = 'presentation-empty';
  const copy = document.createElement('div');
  copy.className = 'presentation-empty__copy';
  const eyebrow = document.createElement('span');
  eyebrow.className = 'presentation-empty__eyebrow';
  eyebrow.textContent = t('empty.eyebrow', undefined, 'New presentation');
  const title = document.createElement('h2');
  title.textContent = t('empty.title', undefined, 'What should this presentation explain?');
  const detail = document.createElement('p');
  detail.textContent = t(
    'empty.detail',
    undefined,
    'Give the topic and optionally point to useful materials. Audience, structure, palette, density, and page count will be inferred.',
  );
  const form = document.createElement('form');
  form.className = 'presentation-empty__brief';
  const topic = document.createElement('textarea');
  topic.rows = 4;
  topic.maxLength = 4000;
  topic.placeholder = t('empty.topicPlaceholder', undefined, 'Example: Explain why activation quality is now our main growth constraint. Use the latest workspace review as evidence.');
  topic.setAttribute('aria-label', t('empty.topicLabel', undefined, 'Presentation topic and optional material hints'));
  const create = document.createElement('button');
  create.type = 'submit';
  create.className = 'command-button command-button--primary';
  create.textContent = t('empty.create', undefined, 'Create presentation');
  form.append(topic, create);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const brief = topic.value.trim();
    if (!brief || state.busy) return;
    setBusy(true);
    try {
      await submitChatIntent(
        `Create a complete PPT Live presentation for this topic: ${brief}\n\n`
        + 'Infer the audience, purpose, page count, palette direction, and density. '
        + 'Commit one complete structured presentation document through the Runtime-owned authoring contract, review it, create the PresentationSystem, and stop after rendering the three-page Design Case for my decision.',
      );
      topic.value = '';
      showToast(t('toasts.generationStarted', undefined, 'Presentation direction sent to the Agent'));
    } catch (error) {
      showToast(error.message || String(error), true);
    } finally {
      setBusy(false);
    }
  });
  copy.append(eyebrow, title, detail, form);

  const systemPreview = document.createElement('div');
  systemPreview.className = 'presentation-empty__system';
  const systemLabel = document.createElement('span');
  systemLabel.textContent = t('empty.designPackage', undefined, 'Design package');
  const systemName = document.createElement('strong');
  systemName.textContent = localizedPresetValue(
    system,
    'name',
    system.name || t('style.defaultName', undefined, 'Presentation system'),
  );
  const swatches = document.createElement('span');
  swatches.className = 'presentation-empty__swatches';
  ['canvas', 'surface', 'ink', 'primary', 'accent'].forEach((token) => {
    const swatch = document.createElement('i');
    swatch.style.setProperty('--empty-swatch', systemColor(token, system));
    swatches.append(swatch);
  });
  systemPreview.append(systemLabel, systemName, swatches);
  empty.append(copy, systemPreview);
  canvas.replaceChildren();
  createSlideRenderLayer(canvas).append(empty);
}

function renderDesignCasePanel() {
  const panel = $('#designCasePanel');
  const stage = $('#canvasStage');
  if (!panel || !stage) return;
  const designCase = state.snapshot?.designCase;
  const visible = designCase?.status === 'awaitingDecision';
  panel.hidden = !visible;
  stage.hidden = visible;
  if (!visible) return;
  $('#designCaseStatus').textContent = t('designCase.awaiting', undefined, 'Waiting for your decision');
  $('#designCaseMeta').textContent = t(
    'designCase.meta',
    { density: designCase.density, system: state.snapshot.presentationSystem.name },
    `${state.snapshot.presentationSystem.name} · ${designCase.density} density · three real manuscript pages`,
  );
  const host = $('#designCasePages');
  host.replaceChildren();
  (designCase.sampleSlides || []).forEach((sample, index) => {
    const article = document.createElement('article');
    article.className = 'design-case-page';
    const frame = document.createElement('div');
    frame.className = 'design-case-page__frame';
    frame.style.setProperty('--slide-bg', sample.renderTree?.canvas?.background || systemColor('canvas'));
    const layer = createSlideRenderLayer(frame);
    ensureSlideAssets({ id: sample.slideId, renderTree: sample.renderTree });
    (sample.renderTree?.nodes || []).forEach((node) => layer.append(renderCompiledNode(node)));
    const caption = document.createElement('div');
    const number = document.createElement('span');
    number.textContent = t('designCase.sample', { number: index + 1 }, `Case ${index + 1}`);
    const title = document.createElement('strong');
    title.textContent = sample.title;
    caption.append(number, title);
    article.append(frame, caption);
    host.append(article);
  });
  requestAnimationFrame(syncSlideRenderLayers);
}

function renderPlannedCanvas(canvas, planItem) {
  const placeholder = document.createElement('div');
  placeholder.className = 'planned-slide';
  const meta = document.createElement('div');
  meta.className = 'planned-slide__meta';
  const recipe = document.createElement('span');
  recipe.textContent = planItem.recipeId || planItem.pageRole;
  const status = document.createElement('strong');
  status.textContent = statusLabel(planItem.status);
  meta.append(recipe, status);
  const title = document.createElement('h2');
  title.textContent = planItem.title;
  const claim = document.createElement('p');
  claim.textContent = planItem.claim;
  const progress = document.createElement('div');
  progress.className = 'planned-slide__progress';
  progress.setAttribute('role', 'status');
  progress.setAttribute('aria-live', 'polite');
  progress.textContent = planItem.status === 'generating'
    ? t('planned.generating', undefined, 'The agent is compiling this slide against the design package.')
    : planItem.status === 'failed'
      ? t(
        'planned.failed',
        undefined,
        'The last attempt failed. The previous good preview is preserved when available.',
      )
      : t('planned.waiting', undefined, 'Waiting in the generation plan.');
  placeholder.append(meta, title, claim, progress);
  canvas.replaceChildren();
  createSlideRenderLayer(canvas).append(placeholder);
}

function renderVisualInspector(slide, index) {
  const inspector = $('#visualInspector');
  inspector.hidden = false;
  $('#inspectorSlideLabel').textContent = t(
    'visual.slideNumber',
    { number: index + 1 },
    `Slide ${index + 1}`,
  );
  $('#inspectorSlideStatus').textContent = statusLabel(slide.status);
  $('#inspectorSlideRecipe').textContent = slide.recipeId || 'legacy-freeform';
}

function selectSlide(slideId, persistSelection = false, userInitiated = false) {
  if (!plannedSlides().some((item) => item.slideId === slideId)) return false;
  if (state.selectedSlideId !== slideId) state.selectedNodeId = null;
  state.selectedSlideId = slideId;
  if (userInitiated) {
    state.userNavigated = true;
    state.followGeneration = false;
    updateFollowGenerationUi();
  }
  renderThumbs();
  renderCanvas();
  updateWorkspaceContext();
  requestAnimationFrame(() => {
    $('#slideThumbs .slide-thumb.is-active')?.scrollIntoView({ block: 'nearest' });
  });
  return true;
}

function selectRelativeSlide(direction, distance = 1) {
  const slides = plannedSlides();
  if (slides.length < 2) return 0;
  const current = Math.max(0, slides.findIndex((slide) => slide.slideId === state.selectedSlideId));
  const next = Math.min(slides.length - 1, Math.max(0, current + direction * Math.max(1, distance)));
  if (next === current) return 0;
  selectSlide(slides[next].slideId, false, true);
  return Math.abs(next - current);
}

function resetWheelNavigation() {
  state.wheelNavigation.accumulated = 0;
  state.wheelNavigation.direction = 0;
}

function handleCanvasWheel(event) {
  if (state.activeView !== 'visual' || event.ctrlKey || event.metaKey) return;
  if (plannedSlides().length < 2) return;
  let delta = Math.abs(event.deltaY) >= Math.abs(event.deltaX) ? event.deltaY : event.deltaX;
  if (!Number.isFinite(delta) || delta === 0) return;
  if (event.deltaMode === WheelEvent.DOM_DELTA_LINE) delta *= 16;
  if (event.deltaMode === WheelEvent.DOM_DELTA_PAGE) delta = Math.sign(delta) * SLIDE_WHEEL_DISTANCE;

  event.preventDefault();
  const now = performance.now();
  if (now - state.wheelNavigation.lastEventAt > WHEEL_NAVIGATION_IDLE_MS) resetWheelNavigation();
  state.wheelNavigation.lastEventAt = now;
  const direction = delta > 0 ? 1 : -1;
  if (direction !== state.wheelNavigation.direction) {
    state.wheelNavigation.accumulated = 0;
    state.wheelNavigation.direction = direction;
  }
  state.wheelNavigation.accumulated += delta;
  const requestedSteps = Math.floor(Math.abs(state.wheelNavigation.accumulated) / SLIDE_WHEEL_DISTANCE);
  if (requestedSteps < 1) return;
  const movedSteps = selectRelativeSlide(direction, requestedSteps);
  if (movedSteps < 1 || movedSteps < requestedSteps) {
    state.wheelNavigation.accumulated = 0;
    return;
  }
  state.wheelNavigation.accumulated -= direction * movedSteps * SLIDE_WHEEL_DISTANCE;
}

function documentNodes() {
  return {
    host: $('#documentEditorHost'),
    save: $('#saveDocument'),
    sync: $('#syncDocument'),
    meta: $('#documentMeta'),
    eyebrow: $('#documentEyebrow'),
  };
}

async function mountDocumentEditor(key) {
  const documentState = state.documents[key];
  state.documentEditor.key = key;
  if (state.documentEditor.view) {
    await state.documentEditor.view.update({
      content: documentState.content,
      fileName: documentState.fileName,
      savedVersion: documentState.revision,
      showToolbar: false,
      showOutline: false,
    });
    requestAnimationFrame(() => state.documentEditor.view?.refresh());
    return state.documentEditor.view;
  }
  const MarkdownEditor = runtime().ui?.MarkdownEditor;
  if (typeof MarkdownEditor !== 'function') {
    throw new Error(t(
      'errors.markdownUnavailable',
      undefined,
      'The system Markdown editor is unavailable in this runtime',
    ));
  }
  const editorView = MarkdownEditor(documentNodes().host, {
    viewId: 'ppt-live-document',
    content: documentState.content,
    fileName: documentState.fileName,
    savedVersion: documentState.revision,
    showToolbar: false,
    showOutline: false,
    onChange(content) {
      const activeKey = state.documentEditor.key;
      if (!activeKey) return;
      const activeDocument = state.documents[activeKey];
      activeDocument.content = content;
      activeDocument.dirty = content !== activeDocument.savedContent;
      updateDocumentUi(activeKey);
    },
    onSave(content) {
      const activeKey = state.documentEditor.key;
      if (!activeKey) return;
      const activeDocument = state.documents[activeKey];
      activeDocument.content = content;
      activeDocument.dirty = content !== activeDocument.savedContent;
      void saveDocumentWithFeedback(activeKey);
    },
  });
  state.documentEditor.view = editorView;
  await editorView.ready;
  return editorView;
}

function updateDocumentUi(key) {
  if (state.activeView !== key) return;
  const documentState = state.documents[key];
  const nodes = documentNodes();
  const isManuscript = key === 'manuscript';
  nodes.save.disabled = state.busy || !documentState.dirty;
  nodes.sync.disabled = state.busy || !documentState.dirty;
  nodes.meta.textContent = documentState.dirty
    ? t(
      'documents.revisionUnsaved',
      { revision: documentState.revision },
      `Revision ${documentState.revision} / Unsaved`,
    )
    : t('documents.revision', { revision: documentState.revision }, `Revision ${documentState.revision}`);
  nodes.eyebrow.textContent = isManuscript
    ? t('documents.manuscript', undefined, 'Design manuscript')
    : t('documents.speaker', undefined, 'Speaker script');
  nodes.save.setAttribute(
    'aria-label',
    isManuscript
      ? t('actions.saveManuscript', undefined, 'Save design manuscript')
      : t('actions.saveSpeaker', undefined, 'Save speaker script'),
  );
  nodes.sync.textContent = isManuscript
    ? t('actions.updatePptWithAi', undefined, 'Update PPT with AI')
    : t('actions.reviewWithAi', undefined, 'Review with AI');
}

async function loadDocument(key, force = false) {
  const documentState = state.documents[key];
  if (documentState.dirty && !force) {
    documentState.stale = true;
    return;
  }
  const output = await callDeck('getDocument', { documentId: documentState.documentId });
  const document = output.document;
  documentState.content = document.content || '';
  documentState.savedContent = document.content || '';
  documentState.revision = document.revision || 0;
  documentState.hash = document.contentHash || '';
  documentState.dirty = false;
  documentState.stale = false;
  if (state.activeView === key) await mountDocumentEditor(key);
  updateDocumentUi(key);
}

async function activateDocument(key) {
  const documentState = state.documents[key];
  if (documentState.stale || documentState.revision === 0) await loadDocument(key);
  await mountDocumentEditor(key);
  updateDocumentUi(key);
}

async function saveDocument(key) {
  const documentState = state.documents[key];
  if (!documentState.dirty) return documentState;
  let committed;
  if (key === 'speaker') {
    const output = await callDeck('commitSpeakerScript', {
      expectedRevision: documentState.revision,
      content: documentState.content,
    });
    committed = output.document;
    if (state.snapshot?.manuscript) {
      state.snapshot.manuscript.speakerScriptRevision = committed.revision;
      state.snapshot.manuscript.speakerScriptHash = committed.contentHash;
    }
    if (state.snapshot?.documents?.speakerScript) {
      state.snapshot.documents.speakerScript.revision = committed.revision;
      state.snapshot.documents.speakerScript.contentHash = committed.contentHash;
    }
  } else {
    if (state.documents.speaker.revision === 0 || state.documents.speaker.stale) await loadDocument('speaker');
    const output = await callDeck('commitPresentationManuscript', {
      expectedManuscriptRevision: documentState.revision,
      expectedSpeakerScriptRevision: state.documents.speaker.revision,
      manuscript: documentState.content,
      speakerScript: state.documents.speaker.content,
      intent: 'Commit the complete user-edited manuscript and aligned speaker script; bind future AI-authored visual pages to this Manuscript revision and invalidate prior visual production state',
    });
    committed = {
      revision: output.documents.manuscript.revision,
      contentHash: output.documents.manuscript.contentHash,
    };
    state.snapshot = { ...state.snapshot, ...output };
    state.documents.speaker.hash = output.documents.speakerScript.contentHash;
    state.documents.speaker.revision = output.documents.speakerScript.revision;
  }
  documentState.savedContent = documentState.content;
  documentState.revision = committed.revision;
  documentState.hash = committed.contentHash;
  documentState.dirty = false;
  documentState.stale = false;
  if (state.documentEditor.key === key) {
    await state.documentEditor.view?.update({
      content: documentState.content,
      savedVersion: documentState.revision,
    });
  }
  updateDocumentUi(key);
  updateExportButton();
  return documentState;
}

async function saveDocumentWithFeedback(key) {
  if (state.busy || !state.documents[key].dirty) return;
  setBusy(true);
  try {
    await saveDocument(key);
    showToast(key === 'manuscript'
      ? t('documents.manuscriptSaved', undefined, 'Design manuscript saved')
      : t('documents.speakerSaved', undefined, 'Speaker script saved'));
  } catch (error) {
    showToast(error.message || String(error), true);
    await refreshSnapshot().catch(() => {});
  } finally {
    setBusy(false);
  }
}

async function saveAndAskAgent(key) {
  setBusy(true);
  try {
    await saveDocument(key);
    const label = key === 'manuscript'
      ? t('documents.manuscriptLabel', undefined, 'design manuscript')
      : t('documents.speakerLabel', undefined, 'speaker script');
    const intent = key === 'manuscript'
      ? 'The user committed a complete replacement 内容.md in PPT Live. Inspect the current parsed Manuscript, prepare and commit one whole-manuscript review, fix narrative root causes if needed, then establish or revise the PresentationSystem and independently design a new three-page Design Case from the Manuscript. Do not generate the complete deck until the user approves that case.'
      : 'The user saved a speaker-script-only revision in PPT Live. Preserve visual state when facts, visible copy, page structure, and design direction are unchanged. If the edit reveals a content inconsistency, propose a whole-manuscript revision rather than patching slides one by one.';
    await submitChatIntent(intent);
    showToast(t(
      'toasts.documentSent',
      { label },
      `Saved ${label} and sent it to the presentation Agent`,
    ));
  } catch (error) {
    showToast(error.message || String(error), true);
  } finally {
    setBusy(false);
  }
}

async function refreshSnapshot() {
  if (state.busy) return;
  const previous = state.snapshot;
  const snapshot = await callDeck('inspect');
  state.snapshot = snapshot;
  const slides = snapshot.deck?.slides || [];
  const plan = plannedSlides();
  const previousRevisions = new Map((previous?.deck?.slides || []).map((slide) => [slide.id, slide.revision]));
  const newlyCommitted = [...slides].reverse().find((slide) => previousRevisions.get(slide.id) !== slide.revision);
  const generating = plan.find((item) => item.status === 'generating');
  const preferred = state.selectedSlideId || snapshot.deck?.selection?.slideId;
  if (state.followGeneration && !state.userNavigated && (newlyCommitted || generating)) {
    state.selectedSlideId = newlyCommitted?.id || generating.slideId;
  } else {
    state.selectedSlideId = plan.some((item) => item.slideId === preferred)
      ? preferred
      : plan[0]?.slideId || null;
  }

  const documentHashes = {
    manuscript: snapshot.documents?.manuscript?.contentHash || '',
    speaker: snapshot.documents?.speakerScript?.contentHash || '',
  };
  for (const key of ['manuscript', 'speaker']) {
    if (documentHashes[key] === state.documents[key].hash) continue;
    state.documents[key].stale = true;
    if (state.activeView === key && !state.documents[key].dirty) await loadDocument(key);
  }

  const visualChanged = previous?.deck?.revision !== snapshot.deck?.revision || previous?.presentationSystem?.revision !== snapshot.presentationSystem?.revision;
  if (!previous || visualChanged) {
    renderThumbs();
    renderCanvas();
  }
  renderDesignCasePanel();
  updateHeader();
  updateFollowGenerationUi();
}

function updateDesignPromptUi() {
  const prompt = $('#designPrompt');
  const submit = $('#changeSystem');
  if (!prompt || !submit) return;
  submit.disabled = state.busy || !prompt.value.trim();
}

function renderDesignSummary() {
  const system = activeSystem();
  const host = $('#designSummary');
  if (!system || !host) return;
  host.replaceChildren();
  const palette = document.createElement('div');
  palette.className = 'design-summary__palette';
  ['canvas', 'surface', 'ink', 'primary', 'accent'].forEach((token) => {
    const swatch = document.createElement('span');
    swatch.style.setProperty('--summary-color', systemColor(token, system));
    swatch.title = semanticLabel('tokens', token);
    palette.append(swatch);
  });
  const copy = document.createElement('div');
  const name = document.createElement('strong');
  name.textContent = localizedPresetValue(system, 'name', system.name);
  const rationale = document.createElement('p');
  rationale.textContent = localizedPresetValue(system, 'rationale', system.rationale);
  copy.append(name, rationale);
  host.append(palette, copy);
}

function updateColorEditorUi() {
  const system = canonicalSystem();
  const dirty = hasColorDraftChanges(system);
  const invalid = state.invalidColorTokens.size > 0;
  const apply = $('#applyColors');
  const reset = $('#resetColors');
  if (apply) apply.disabled = state.busy || !dirty || invalid;
  if (reset) reset.disabled = state.busy || !dirty;
  $$('#colorEditor input').forEach((input) => { input.disabled = state.busy; });
}

function previewColorDraft() {
  renderDesignSummary();
  renderThumbs();
  renderCanvas();
  updateColorEditorUi();
  updateExportButton();
}

function setColorDraft(token, value) {
  const normalized = String(value || '').trim().toUpperCase();
  if (!/^#[0-9A-F]{6}$/.test(normalized)) return false;
  ensureColorDraft();
  state.colorDraft[token] = normalized;
  state.invalidColorTokens.delete(token);
  previewColorDraft();
  return true;
}

function renderColorEditor() {
  const system = canonicalSystem();
  const host = $('#colorEditor');
  if (!system || !host) return;
  ensureColorDraft(system);
  host.replaceChildren();
  const groups = [
    ...COLOR_TOKEN_GROUPS,
    {
      labelKey: 'design.paletteData',
      tokens: system.color.dataSeries.map((_entry, index) => `data.${index + 1}`),
    },
  ];
  groups.forEach((group) => {
    const section = document.createElement('section');
    section.className = 'color-editor__group';
    const heading = document.createElement('h3');
    heading.className = 'color-editor__group-title';
    heading.textContent = t(group.labelKey, undefined, group.labelKey);
    section.append(heading);
    group.tokens.forEach((token) => {
      const label = semanticLabel('tokens', token);
      const inputId = `semantic-color-${token.replace(/\./g, '-')}`;
      const row = document.createElement('div');
      row.className = 'color-editor__row';
      const name = document.createElement('label');
      name.className = 'color-editor__label';
      name.htmlFor = inputId;
      name.textContent = label;
      const swatch = document.createElement('input');
      swatch.id = inputId;
      swatch.className = 'color-editor__swatch';
      swatch.type = 'color';
      swatch.value = state.colorDraft[token];
      swatch.title = t('system.changeColor', { name: label }, `Change ${label} color`);
      swatch.setAttribute('aria-label', swatch.title);
      const hex = document.createElement('input');
      hex.className = 'color-editor__hex';
      hex.type = 'text';
      hex.value = state.colorDraft[token];
      hex.maxLength = 7;
      hex.spellcheck = false;
      hex.setAttribute('aria-label', `${label} HEX`);
      swatch.addEventListener('input', () => {
        hex.value = swatch.value.toUpperCase();
        hex.classList.remove('is-invalid');
        setColorDraft(token, swatch.value);
      });
      hex.addEventListener('input', () => {
        const value = hex.value.trim().toUpperCase();
        hex.value = value;
        if (setColorDraft(token, value)) {
          swatch.value = value;
          hex.classList.remove('is-invalid');
          return;
        }
        state.invalidColorTokens.add(token);
        hex.classList.add('is-invalid');
        updateColorEditorUi();
      });
      hex.addEventListener('blur', () => {
        if (!state.invalidColorTokens.has(token)) return;
        hex.value = state.colorDraft[token];
        hex.classList.remove('is-invalid');
        state.invalidColorTokens.delete(token);
        updateColorEditorUi();
      });
      row.append(name, swatch, hex);
      section.append(row);
    });
    host.append(section);
  });
  updateColorEditorUi();
}

function resetColorDraft() {
  state.colorDraftRevision = null;
  ensureColorDraft();
  renderColorEditor();
  previewColorDraft();
}

async function applyColorDraft() {
  const current = canonicalSystem();
  if (!current || state.busy || !hasColorDraftChanges(current) || state.invalidColorTokens.size) return;
  const presentationSystem = { ...activeSystem() };
  delete presentationSystem.revision;
  delete presentationSystem.createdAt;
  delete presentationSystem.updatedAt;
  delete presentationSystem.contentHash;
  setBusy(true);
  try {
    const output = await callDeck('setPresentationSystem', {
      expectedRevision: current.revision,
      expectedDeckRevision: state.snapshot.deck.revision,
      presentationSystem,
      intent: 'User manually edited semantic presentation colors in PPT Live Design',
    });
    state.snapshot = { ...state.snapshot, ...output };
    state.colorDraft = null;
    state.colorDraftRevision = null;
    state.invalidColorTokens.clear();
    renderThumbs();
    renderCanvas();
    renderDesignCasePanel();
    updateHeader();
    showToast(t('toasts.colorsApplied', undefined, 'Semantic colors applied to preview and PowerPoint export'));
  } catch (error) {
    showToast(error.message || String(error), true);
  } finally {
    setBusy(false);
  }
}

function renderSystem() {
  if (!activeSystem()) return;
  renderDesignSummary();
  renderColorEditor();
  updateDesignPromptUi();
}

function selectView(view) {
  const documentOpen = view === 'manuscript' || view === 'speaker';
  state.activeView = view;
  $('#pptLiveRoot').dataset.view = view;
  $('#visualView').hidden = documentOpen;
  $('#documentView').hidden = !documentOpen;
  if (documentOpen) setDesignPanel(false);
  if (view === 'visual') requestAnimationFrame(renderCanvas);
  if (documentOpen) {
    void activateDocument(view).catch((error) => showToast(error.message || String(error), true));
  }
  updateWorkspaceContext();
}

async function refineSystemWithAi() {
  const system = activeSystem();
  const prompt = $('#designPrompt').value.trim();
  if (!system || state.busy || !prompt) return;
  setBusy(true);
  try {
    await submitChatIntent(
      `Refine the current PresentationSystem '${system.systemId}' at system revision ${system.revision}. `
      + `The user's visual direction is: "${prompt}". `
      + 'Keep the frozen manuscript meaning, visible copy, and slide order stable unless the feedback explicitly requires content change. '
      + 'Change the appropriate PresentationSystem or recipe-family root cause, invalidate the current Design Case, and render a new three-page Design Case. '
      + 'Do not continue full page production until the new case is approved; do not start a per-slide review loop.',
    );
    $('#designPrompt').value = '';
    updateDesignPromptUi();
    showToast(t('toasts.designSent', undefined, 'Design system sent to the presentation Agent'));
  } catch (error) {
    showToast(error.message || String(error), true);
  } finally {
    setBusy(false);
  }
}

async function undoVisual() {
  if (!state.snapshot?.canUndo) return;
  setBusy(true);
  try {
    const output = await callDeck('undo', {
      expectedDeckRevision: state.snapshot.deck.revision,
      expectedSystemRevision: state.snapshot.presentationSystem.revision,
    });
    state.snapshot = { ...state.snapshot, ...output };
    const slides = state.snapshot.deck.slides || [];
    if (!slides.some((slide) => slide.id === state.selectedSlideId)) {
      state.selectedSlideId = slides[0]?.id || null;
    }
    renderThumbs();
    renderCanvas();
    updateHeader();
    showToast(t('toasts.undoComplete', undefined, 'Latest presentation change undone'));
  } catch (error) {
    showToast(error.message || String(error), true);
  } finally {
    setBusy(false);
  }
}

async function exportPresentation() {
  setBusy(true);
  try {
    const review = state.snapshot.latestReview;
    const output = await callDeck('export', {
      format: 'pptx',
      expectedDeckRevision: state.snapshot.deck.revision,
      expectedSystemRevision: state.snapshot.presentationSystem.revision,
      reviewId: review.reviewId,
    });
    showToast(t(
      'toasts.exportComplete',
      {
        count: output.artifact.validation.slideCount,
        filename: output.artifact.filename,
      },
      `Validated and exported ${output.artifact.validation.slideCount} slides to ${output.artifact.filename}`,
    ));
  } catch (error) {
    showToast(error.message || String(error), true);
  } finally {
    setBusy(false);
  }
}

function bindEvents() {
  $('#manuscriptButton').addEventListener('click', () => {
    selectView(state.activeView === 'manuscript' ? 'visual' : 'manuscript');
  });
  $('#designButton').addEventListener('click', () => setDesignPanel(!state.designPanelOpen));
  $('#closeDesign').addEventListener('click', () => setDesignPanel(false));
  $('#closeDocument').addEventListener('click', () => selectView('visual'));
  $('#speakerButton').addEventListener('click', () => {
    selectView(state.activeView === 'speaker' ? 'visual' : 'speaker');
  });
  $('#designPrompt').addEventListener('input', updateDesignPromptUi);
  $$('[data-design-prompt-key]').forEach((button) => {
    button.addEventListener('click', () => {
      const prompt = $('#designPrompt');
      prompt.value = t(button.dataset.designPromptKey, undefined, button.textContent.trim());
      updateDesignPromptUi();
      prompt.focus();
    });
  });
  $('#changeSystem').addEventListener('click', refineSystemWithAi);
  $('#resetColors').addEventListener('click', resetColorDraft);
  $('#applyColors').addEventListener('click', applyColorDraft);
  $('#undoButton').addEventListener('click', undoVisual);
  $('#exportButton').addEventListener('click', exportPresentation);
  $('#zoomOut').addEventListener('click', () => {
    state.zoom = Math.max(0.6, Math.round((state.zoom - 0.1) * 10) / 10);
    renderCanvas();
  });
  $('#zoomIn').addEventListener('click', () => {
    state.zoom = Math.min(1.4, Math.round((state.zoom + 0.1) * 10) / 10);
    renderCanvas();
  });
  $('#canvasStage').addEventListener('wheel', handleCanvasWheel, { passive: false });
  $('#slideCanvas').addEventListener('pointerdown', (event) => {
    if (event.target !== event.currentTarget && !event.target.classList.contains('slide-render-layer')) return;
    selectVisualNode(null);
  });
  $('#followGeneration').addEventListener('click', () => {
    state.followGeneration = !state.followGeneration;
    state.userNavigated = false;
    updateFollowGenerationUi();
    if (state.followGeneration) {
      const target = [...plannedSlides()].reverse().find((item) => item.status === 'generating' || item.slideRevision > 0);
      if (target) selectSlide(target.slideId);
    }
  });
  const documentControls = documentNodes();
  documentControls.save.addEventListener('click', () => {
    if (state.activeView === 'manuscript' || state.activeView === 'speaker') void saveDocumentWithFeedback(state.activeView);
  });
  documentControls.sync.addEventListener('click', () => {
    if (state.activeView === 'manuscript' || state.activeView === 'speaker') void saveAndAskAgent(state.activeView);
  });

  let resizeFrame = 0;
  window.addEventListener('resize', () => {
    cancelAnimationFrame(resizeFrame);
    resizeFrame = requestAnimationFrame(() => {
      if (state.activeView === 'visual') syncSlideRenderLayers();
      else state.documentEditor.view?.refresh();
    });
  });
  const scheduleRefresh = () => {
    clearTimeout(state.refreshTimer);
    state.refreshTimer = setTimeout(() => refreshSnapshot().catch(() => {}), 180);
  };
  const shouldRefreshFromBackendEvent = (payload) => {
    if (!payload || typeof payload !== 'object') return false;
    if (payload.sourceEvent === 'agentic://dialog-turn-completed') return true;
    if (payload.sourceEvent === 'agentic://tool-event') {
      const eventType = String(payload.toolEvent?.event_type || payload.eventType || '').toLowerCase();
      return eventType === 'completed' || eventType === 'failed';
    }
    if (payload.sourceEvent === 'product-app-runtime-backend-event') {
      return [
        'commitPresentationManuscript', 'commitSpeakerScript', 'reviewPresentationManuscript',
        'setPresentationSystem', 'renderDesignCase', 'decideDesignCase', 'prepareVisualAssets',
        'generateSlideVisual', 'editVisual', 'reviewDeck', 'undo', 'export',
      ].includes(payload.action);
    }
    return false;
  };
  window.addEventListener('message', (event) => {
    const message = event.data;
    if (!message || typeof message !== 'object') return;
    if (
      message.event === 'productAppRuntimeAgentToolEvent' ||
      message.event === 'productAppRuntimeActivate' ||
      message.event === 'productAppRuntimeRouteChange' ||
      (message.event === 'backend:event' && shouldRefreshFromBackendEvent(message.payload))
    ) {
      scheduleRefresh();
    }
  });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) void refreshSnapshot().catch(() => {});
  });
  window.addEventListener('beforeunload', () => {
    clearTimeout(state.refreshTimer);
    void state.documentEditor.view?.unmount();
  });
}

async function boot() {
  applyStaticTexts();
  updateFollowGenerationUi();
  bindEvents();
  try {
    await refreshSnapshot();
    $('#bootState').hidden = true;
  } catch (error) {
    const bootState = $('#bootState');
    const message = error.message || String(error);
    bootState.textContent = t('errors.bootFailed', { message }, `PPT Live could not open: ${message}`);
    showToast(error.message || String(error), true);
  }
}

runtime().onLocaleChange?.(() => renderLocalizedUi());
window.addEventListener('DOMContentLoaded', boot);
