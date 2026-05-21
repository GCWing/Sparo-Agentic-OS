import { translate as t } from './src/i18n.js';
import {
  ELEMENT_TYPES,
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
  normalizeElement,
  normalizeSlide,
  uid,
} from './src/state.js';
import {
  applyDeckInstructionWithAi,
  applySlideInstructionWithAi,
  enrichSources,
  generateDeckWithAi,
  generateOutlineWithAi,
  insertSlideWithAi,
  compileBlueprint,
  localDeck,
  localDeckUpdate,
  localInsertedSlide,
  localOutline,
  localSlideUpdate,
  planPresentationTaskWithAi,
} from './src/deck-ai.js';
import { applyI18n, readInputs, renderAll, renderInspector, renderSlideCanvas, renderGeneration, renderThumbs, slideHtml } from './src/render.js';
import { downloadBase64File, downloadHtmlDeck, fileSafe } from './src/export-html.js';

let state = createInitialState();
let busy = false;
let dragState = null;
let activeBackendRun = null;

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
    state = createInitialState();
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
    if (node.id === 'cancelGeneration') {
      node.disabled = !busy;
      node.hidden = !busy;
      return;
    }
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
  state.generation.events = [];
  renderGeneration(state);
}

function addGenerationEvent(event, detail = '', kind = 'info') {
  const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const entry = typeof event === 'string'
    ? { time, title: event, text: event, detail, kind }
    : {
        time,
        title: event.title || event.text || '',
        text: event.text || event.title || '',
        detail: event.detail || detail || '',
        kind: event.kind || kind,
      };
  state.generation.events = [...(state.generation.events || []), entry].slice(-40);
  renderGeneration(state);
}

function updateLastGenerationEvent(matchKind, patch) {
  const events = state.generation.events || [];
  const index = [...events].reverse().findIndex((item) => item.kind === matchKind);
  if (index < 0) {
    addGenerationEvent(patch);
    return;
  }
  const realIndex = events.length - 1 - index;
  state.generation.events = events.map((item, itemIndex) => (
    itemIndex === realIndex ? { ...item, ...patch } : item
  ));
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
    || state.title === t('defaultDeckTitle')
    || isStarterDeck();
}

function isStarterDeck() {
  const title = String(state.title || '').trim();
  const onlyStarterSlide = state.slides.length === 1
    && state.outline.length === 1
    && state.outline[0] === t('newSlideTitle');
  return onlyStarterSlide
    && (title === t('blankDeckTitle') || title === t('newSlideTitle'));
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
    setStatus(t('deckReady'));
  } catch (error) {
    runtime().log?.warn?.('PPT Live deck AI failed', { error: String(error) });
    setGenerationStep('proof', 'done');
    setGenerationStep('design', 'running', t('generationLocalCompiler'));
    await waitFrame();
    state = localDeck(state);
    setGenerationStep('design', 'done');
    setGenerationStep('compile', 'done');
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
  const instruction = promptValue();
  if (!instruction) {
    setStatus(t('promptRequired'));
    return;
  }
  updateBriefFromInputs();
  try {
    await runPptLiveBackend('auto', instruction);
    return;
  } catch (error) {
    if (isStoppedBackendError(error)) return;
    runtime().log?.warn?.('PPT Live backend generation failed', { error: String(error) });
    setStatus(t('backendGenerationFailed'));
    addGenerationEvent(t('backendGenerationFailed'));
    await persist(true);
    return;
  }
  setBusy(true, t('working'));
  resetGeneration();
  setGenerationStep('brief', 'running', t('agentPlanning'));
  try {
    const plan = await planPresentationTaskWithAi(state, instruction);
    runtime().log?.info?.('PPT Live agent plan selected', {
      operation: plan.operation,
      scope: plan.scope,
      slideIndex: plan.slideIndex,
      stepCount: plan.steps.length,
    });
    setGenerationStep('brief', 'done');
    setBusy(false);
    await executeAgentPlan(plan);
  } catch (error) {
    runtime().log?.warn?.('PPT Live agent planning failed', { error: String(error) });
    setGenerationStep('brief', 'error', t('agentPlanningFallback'));
    setBusy(false);
    await executeAgentPlan(localAgentPlan());
  }
}

async function executeAgentPlan(plan) {
  const operation = coerceAgentOperation(plan.operation);
  applyBriefPatch(plan.briefPatch);
  focusPlannedSlide(plan);
  switch (operation) {
    case 'generate_deck':
      await generateDeckFromPrompt();
      return;
    case 'update_outline':
      await generateOutline();
      return;
    case 'revise_slide':
      await reviseCurrentSlide();
      return;
    case 'insert_slide':
      await insertSlideFromPrompt();
      return;
    case 'delete_slide':
      deleteSlide();
      return;
    case 'revise_deck':
    default:
      await reviseDeck();
  }
}

async function runPptLiveBackend(operation, instruction) {
  const host = runtime();
  if (!host.backend?.call) throw new Error('PPT Live backend is unavailable');
  updateBriefFromInputs();
  setBusy(true, t('working'));
  resetGeneration();
  setGenerationStep('brief', 'running', t('generationReadingBrief'));
  addGenerationEvent({ title: t('processEventStarted'), detail: t('processEventWaiting'), kind: 'start' });
  prepareAgentGenerationSurface(operation, instruction);
  let sessionId = null;
  let turnId = null;
  let textBuffer = '';
  let settled = false;
  const cleanup = [];
  const timeoutMs = 300000;
  const waitForResult = new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      if (!settled) {
        reject(new Error('PPT Live backend timed out'));
        if (sessionId && turnId) void stopBackendRun(true);
      }
    }, timeoutMs);
    cleanup.push(() => clearTimeout(timer));
    const listener = (event) => {
      if (sessionId && event.sessionId && event.sessionId !== sessionId) return;
      const sourceEvent = String(event.sourceEvent || '');
      if (sourceEvent.endsWith('dialog-turn-started')) {
        addGenerationEvent({
          title: t('eventTurnStarted'),
          detail: compactId(event.turnId),
          kind: 'turn',
        });
      } else if (sourceEvent.endsWith('model-round-started')) {
        setGenerationStep('spine', 'running', t('generationWritingClaims'));
        addGenerationEvent({
          title: t('processEventRound'),
          detail: compactId(event.roundId),
          kind: 'round',
        });
      } else if (sourceEvent.endsWith('model-round-completed')) {
        addGenerationEvent({
          title: t('eventRoundCompleted'),
          detail: compactId(event.roundId),
          kind: 'round-done',
        });
      } else if (sourceEvent.endsWith('tool-event')) {
        setGenerationStep('brief', 'running', t('generationReadingBrief'));
        setGenerationStep('proof', 'running', t('generationChoosingProof'));
        addGenerationEvent(describeToolEvent(event));
      } else if (sourceEvent.endsWith('text-chunk')) {
        const chunk = String(event.text || '');
        textBuffer += chunk;
        setGenerationStep('design', 'running', t('generationDesigningLayouts'));
        if (chunk.trim()) {
          updateLastGenerationEvent('text', {
            title: event.contentType === 'thinking' ? t('eventThinkingChunk') : t('processEventText'),
            text: event.contentType === 'thinking' ? t('eventThinkingChunk') : t('processEventText'),
            detail: compactText(chunk),
            kind: 'text',
          });
        }
      } else if (sourceEvent.endsWith('token-usage-updated')) {
        addGenerationEvent({
          title: t('eventTokenUsage'),
          detail: formatTokenUsage(event),
          kind: 'tokens',
        });
      } else if (sourceEvent.endsWith('dialog-turn-completed')) {
        settled = true;
        addGenerationEvent({ title: t('processEventDone'), detail: compactId(event.turnId), kind: 'done' });
        resolve(textBuffer);
      } else if (sourceEvent.endsWith('dialog-turn-failed') || sourceEvent.endsWith('dialog-turn-cancelled')) {
        settled = true;
        addGenerationEvent({
          title: sourceEvent.endsWith('dialog-turn-cancelled') ? t('eventTurnCancelled') : t('eventTurnFailed'),
          detail: compactText(event.error || event.turnId || ''),
          kind: 'error',
        });
        reject(new Error(sourceEvent));
      }
    };
    host.backend.onEvent(listener);
    cleanup.push(() => host.backend.offEvent?.(listener));
  });

  try {
    const result = await withTimeout(host.backend.call('ppt.generate', {
      operation,
      instruction,
      locale: host.locale || document.documentElement.lang || 'zh-CN',
      brief: clone(state.brief),
      title: state.title,
      outline: clone(state.outline),
      currentSlideIndex: getActiveIndex(state),
      currentDeck: {
        title: state.title,
        slides: clone(state.slides),
      },
    }, {
      entityId: 'deck',
      idempotencyKey: `ppt-live-${Date.now()}`,
    }), timeoutMs);
    sessionId = result?.sessionId || null;
    turnId = result?.turnId || result?.actionRunId || null;
    activeBackendRun = sessionId && turnId ? { sessionId, turnId } : null;
    setGenerationStep('brief', 'done');
    const finalText = await waitForResult;
    const payload = extractBackendJson(finalText);
    if (!Array.isArray(payload?.slides) || payload.slides.length === 0) {
      throw new Error('PPT Live backend returned no slides');
    }
    setGenerationStep('spine', 'done');
    setGenerationStep('proof', 'done');
    const previousTarget = state.brief.slideTarget;
    if (Array.isArray(payload.outline) && payload.outline.length) {
      state.outline = payload.outline.map(String);
      state.brief.slideTarget = payload.outline.length;
    } else {
      state.brief.slideTarget = payload.slides.length || previousTarget;
    }
    const compiled = compileBlueprint(
      { title: payload.title || state.title, slides: payload.slides },
      state,
      { respectSlideTarget: false },
    );
    state.title = compiled.title;
    state.slides = compiled.slides;
    state.outline = state.slides.map((slide) => slide.title);
    state.brief.slideTarget = state.slides.length;
    state.sources = {
      ...state.sources,
      facts: payload.researchReport?.verifiedFacts || state.sources?.facts || [],
      warnings: payload.researchReport?.warnings || state.sources?.warnings || [],
      summary: payload.researchReport?.summary || state.sources?.summary || '',
      fetchedAt: Date.now(),
    };
    state.activeSlideId = state.slides[0]?.id || '';
    state.selectedElementId = state.slides[0]?.elements[0]?.id || '';
    setGenerationStep('design', 'done');
    setGenerationStep('compile', 'done', t('generationCompiled'));
    setStatus(t('deckReady'));
    rerender();
    await persist(true);
  } finally {
    cleanup.forEach((fn) => fn());
    activeBackendRun = null;
    state.generation.active = false;
    setBusy(false);
    renderGeneration(state);
  }
}

function prepareAgentGenerationSurface(operation, instruction) {
  if (operation !== 'auto' || (!isDefaultDraft() && !isStarterDeck())) {
    setStatus(t('generationAgentWorking'));
    addGenerationEvent(t('generationAgentWorking'));
    rerender();
    return;
  }
  showAgentWorkingCanvas(instruction);
}

function showAgentWorkingCanvas(instruction) {
  try {
    const slide = normalizeSlide({
      id: uid('agent-working-slide'),
      title: t('agentWorkingTitle'),
      subtitle: '',
      kicker: t('agentWorkingKicker'),
      claim: t('agentWorkingClaim'),
      proofObject: t('agentWorkingProof'),
      supportNote: instruction || t('agentWorkingDetail'),
      sourceNote: t('agentWorkingSourceNote'),
      notes: t('agentWorkingSourceNote'),
      layout: 'brief',
      theme: {
        background: '#fbfcff',
        ink: '#111827',
        muted: '#5b6575',
        primary: '#ff4f46',
        accent: '#14b8a6',
        panel: '#ffffff',
      },
      elements: [
        {
          type: 'text',
          text: t('agentWorkingTitle'),
          x: 9,
          y: 16,
          w: 72,
          h: 13,
          style: { fontSize: 32, fontWeight: 820, color: 'ink', background: 'transparent', borderRadius: 0, opacity: 1, align: 'left' },
        },
        {
          type: 'text',
          text: t('agentWorkingDetail'),
          x: 10,
          y: 34,
          w: 58,
          h: 10,
          style: { fontSize: 16, fontWeight: 650, color: 'muted', background: 'transparent', borderRadius: 0, opacity: 1, align: 'left' },
        },
        {
          type: 'list',
          items: [
            t('generationReadingBrief'),
            t('generationWritingClaims'),
            t('generationChoosingProof'),
            t('generationDesigningLayouts'),
          ],
          x: 10,
          y: 50,
          w: 50,
          h: 29,
          style: { fontSize: 18, fontWeight: 650, color: 'ink', background: 'transparent', borderRadius: 0, opacity: 1, align: 'left' },
        },
        {
          type: 'shape',
          x: 67,
          y: 20,
          w: 22,
          h: 52,
          style: { fontSize: 18, fontWeight: 700, color: 'accent', background: 'primary', borderRadius: 24, opacity: 0.12, align: 'center' },
        },
        {
          type: 'metric',
          text: t('agentWorkingMetric'),
          label: t('agentWorkingMetricLabel'),
          x: 65,
          y: 42,
          w: 26,
          h: 20,
          style: { fontSize: 34, fontWeight: 830, color: 'primary', background: 'panel', borderRadius: 14, opacity: 1, align: 'left' },
        },
      ],
    }, 0, { ...state, slides: [] });
    state.title = t('agentWorkingTitle');
    state.slides = [slide];
    state.outline = [slide.title];
    state.activeSlideId = slide.id;
    state.selectedElementId = getActiveSlide(state)?.elements[0]?.id || '';
    setStatus(t('generationAgentWorking'));
    addGenerationEvent(t('generationAgentWorking'));
    rerender();
  } catch (error) {
    runtime().log?.warn?.('PPT Live working canvas failed', { instruction, error: String(error) });
  }
}

function withTimeout(promise, timeoutMs) {
  let timer = null;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('PPT Live backend timed out')), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

function describeToolEvent(event) {
  const toolEvent = normalizeToolEvent(event.toolEvent || {});
  const name = toolEvent.tool_name || toolEvent.toolName || toolEvent.name || t('eventUnknownTool');
  const eventType = toolEvent.event_type || toolEvent.eventType || 'ToolEvent';
  const labels = {
    EarlyDetected: t('eventToolDetected'),
    ParamsPartial: t('eventToolParams'),
    Queued: t('eventToolQueued'),
    Waiting: t('eventToolWaiting'),
    Started: t('eventToolStarted'),
    Progress: t('eventToolProgress'),
    Streaming: t('eventToolStreaming'),
    StreamChunk: t('eventToolStreamChunk'),
    ConfirmationNeeded: t('eventToolConfirmation'),
    Confirmed: t('eventToolConfirmed'),
    Rejected: t('eventToolRejected'),
    Completed: t('eventToolCompleted'),
    Failed: t('eventToolFailed'),
    Cancelled: t('eventToolCancelled'),
  };
  return {
    title: `${labels[eventType] || t('processEventTool')} ${name}`,
    detail: toolEventDetail(eventType, toolEvent),
    kind: eventType === 'Failed' || eventType === 'Cancelled' || eventType === 'Rejected' ? 'error' : 'tool',
  };
}

function normalizeToolEvent(toolEvent) {
  if (toolEvent.event_type || toolEvent.eventType || toolEvent.tool_name || toolEvent.toolName) return toolEvent;
  const keys = [
    'EarlyDetected',
    'ParamsPartial',
    'Queued',
    'Waiting',
    'Started',
    'Progress',
    'Streaming',
    'StreamChunk',
    'ConfirmationNeeded',
    'Confirmed',
    'Rejected',
    'Completed',
    'Failed',
    'Cancelled',
  ];
  const key = keys.find((candidate) => toolEvent && Object.prototype.hasOwnProperty.call(toolEvent, candidate));
  if (!key) return toolEvent || {};
  const value = toolEvent[key] || {};
  return { ...value, event_type: key };
}

function toolEventDetail(eventType, toolEvent) {
  if (eventType === 'Progress') return compactText(toolEvent.message || '');
  if (eventType === 'Completed') {
    const duration = Number(toolEvent.duration_ms || toolEvent.durationMs || 0);
    const summary = summarizeJson(toolEvent.result_for_assistant || toolEvent.result);
    return [duration ? `${duration}ms` : '', summary].filter(Boolean).join(' · ');
  }
  if (eventType === 'Failed') return compactText(toolEvent.error || '');
  if (eventType === 'StreamChunk') return summarizeJson(toolEvent.data);
  if (eventType === 'ParamsPartial') return compactText(toolEvent.params || '');
  if (toolEvent.params) return summarizeJson(toolEvent.params);
  if (toolEvent.position !== undefined) return `${t('eventToolQueuePosition')} ${toolEvent.position}`;
  return compactId(toolEvent.tool_id || toolEvent.toolId || '');
}

function summarizeJson(value) {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return compactText(value);
  try {
    return compactText(JSON.stringify(value));
  } catch {
    return compactText(String(value));
  }
}

function compactText(value, limit = 180) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  return text.length > limit ? `${text.slice(0, limit - 1)}...` : text;
}

function compactId(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  return text.length > 14 ? text.slice(0, 14) : text;
}

function formatTokenUsage(event) {
  const total = Number(event.totalTokens || event.total_tokens || 0);
  const input = Number(event.inputTokens || event.input_tokens || 0);
  const output = Number(event.outputTokens || event.output_tokens || 0);
  if (!total && !input && !output) return compactId(event.turnId || '');
  return `in ${input} · out ${output} · total ${total}`;
}

async function stopBackendRun(fromTimeout = false) {
  const run = activeBackendRun;
  activeBackendRun = null;
  if (run && runtime().backend?.cancel) {
    try {
      await runtime().backend.cancel(run.sessionId, run.turnId);
    } catch (error) {
      runtime().log?.warn?.('PPT Live backend cancel failed', { error: String(error) });
    }
  }
  state.generation.active = false;
  state.generation.steps = state.generation.steps.map((step) => step.status === 'running' ? { ...step, status: 'error' } : step);
  setStatus(fromTimeout ? t('generationTimedOut') : t('generationStopped'));
  addGenerationEvent(fromTimeout ? t('generationTimedOut') : t('generationStopped'));
  setBusy(false);
  renderGeneration(state);
  await persist(true);
}

function extractBackendJson(text) {
  const raw = String(text || '').trim();
  if (!raw) throw new Error('PPT Live backend produced no text');
  try {
    return JSON.parse(raw);
  } catch {
    const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced) return JSON.parse(fenced[1]);
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start >= 0 && end > start) return JSON.parse(raw.slice(start, end + 1));
    throw new Error('PPT Live backend returned invalid JSON');
  }
}

function isStoppedBackendError(error) {
  const message = String(error || '');
  return message.includes('timed out')
    || message.includes('dialog-turn-cancelled')
    || message.includes('Generation stopped');
}

function coerceAgentOperation(operation) {
  if ((isDefaultDraft() || isStarterDeck()) && ['revise_deck', 'revise_slide', 'insert_slide'].includes(operation)) {
    return 'generate_deck';
  }
  return operation;
}

function applyBriefPatch(patch = {}) {
  state.brief = { ...state.brief, ...patch };
  state = ensureState(state);
}

function focusPlannedSlide(plan) {
  if (plan.scope !== 'slide_index' || plan.slideIndex === null) return;
  const slide = state.slides[plan.slideIndex];
  if (!slide) return;
  state.activeSlideId = slide.id;
  state.selectedElementId = slide.elements[0]?.id || '';
}

function localAgentPlan() {
  return {
    operation: isDefaultDraft() || isStarterDeck() ? 'generate_deck' : 'revise_deck',
    scope: 'deck',
    slideIndex: null,
    briefPatch: {},
    needsSources: true,
    reason: 'Local fallback plan',
    steps: [],
    acceptanceCriteria: [],
  };
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
  try {
    await runPptLiveBackend('revise_deck', instruction);
    return;
  } catch (error) {
    if (isStoppedBackendError(error)) return;
    runtime().log?.warn?.('PPT Live backend revision failed', { error: String(error) });
    setStatus(t('backendGenerationFailed'));
    addGenerationEvent(t('backendGenerationFailed'));
    await persist(true);
    return;
  }
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
    state.brief.slideTarget = state.slides.length;
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
  state = createBlankDeckState();
  rerender();
  setStatus(t('blankDeckReady'));
  void persist(true);
}

function createBlankDeckState() {
  const next = createInitialState();
  next.title = t('blankDeckTitle');
  next.brief.topic = '';
  next.brief.material = '';
  next.outline = [t('newSlideTitle')];
  next.sources = { items: [], facts: [], warnings: [], summary: '', fetchedAt: 0 };
  next.slides = [makeSlide(t('newSlideTitle'), 0, 1, next)];
  next.activeSlideId = next.slides[0]?.id || '';
  next.selectedElementId = next.slides[0]?.elements[0]?.id || '';
  next.presentIndex = 0;
  return ensureState(next);
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
    const result = await runtime().call('worker.call', { method: 'exportPptx', params: { deck: clone(state) } });
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
  $('cancelGeneration')?.addEventListener('click', () => void stopBackendRun(false));
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
