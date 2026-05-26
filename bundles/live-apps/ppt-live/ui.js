import { translate as t, getLocale } from './src/i18n.js';
import {
  ELEMENT_TYPES,
  HISTORY_KEY,
  STORAGE_KEY,
  clamp,
  clone,
  createInitialState,
  defaultOutline,
  defaultElement,
  ensureState,
  escapeHtml,
  getActiveIndex,
  getActiveSlide,
  getSelectedElement,
  makeSlide,
  normalizeElement,
  normalizeGeneration,
  normalizeSlide,
  normalizeDensity,
  densityToIndex,
  indexToDensity,
  uid,
} from './src/state.js';
import { applyI18n, readInputs, renderAll, renderInspector, renderSlideCanvas, renderGeneration, renderGenerationOverlay, renderThumbs, slideHtml, fitSlideCanvas, fitHtmlSlideFrame, buildExportPreviewStage, fitExportPreviewFrame, fitThumbPreviews, normalizeSlideDocument, observeThumbPreviews, syncDensitySlider } from './src/render.js';
import { downloadBase64File, downloadHtmlDeck, fileSafe } from './src/export-html.js';
import { exportFormatIcon, exportFormatTone } from './src/export-format-icons.js';

let state = createInitialState();
let busy = false;
let dragState = null;
/** @type {{ sessionId: string, turnId: string }[]} */
let backendRuns = [];
let deckEpoch = 0;
let promptSubmitGuard = false;
let backendRunInFlight = false;
let historyItems = [];
let lastHistoryWriteAt = 0;

const $ = (id) => document.getElementById(id);
const runtime = () => window.app || {};
const STORAGE_TIMEOUT_MS = 2500;
const memoryStorage = new Map();

function safeLocalStorageGet(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return memoryStorage.has(key) ? memoryStorage.get(key) : null;
  }
}

function safeLocalStorageSet(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    memoryStorage.set(key, value);
  }
}

const localStorageBackend = {
  get: async (key) => JSON.parse(safeLocalStorageGet(key) || 'null'),
  set: async (key, value) => safeLocalStorageSet(key, JSON.stringify(value)),
};

function storage() {
  const host = runtime();
  if (host.storage) return host.storage;
  return localStorageBackend;
}

async function storageGet(key) {
  const backend = storage();
  if (backend === localStorageBackend || !runtime().storage) {
    return backend.get(key);
  }
  try {
    return await Promise.race([
      backend.get(key),
      new Promise((_, reject) => setTimeout(() => reject(new Error('storage-timeout')), STORAGE_TIMEOUT_MS)),
    ]);
  } catch (error) {
    runtime().log?.warn?.('Host storage read timed out, using local fallback', { key, error: String(error) });
    return localStorageBackend.get(key);
  }
}

async function storageSet(key, value) {
  const backend = storage();
  if (backend === localStorageBackend || !runtime().storage) {
    await backend.set(key, value);
    return;
  }
  try {
    await Promise.race([
      backend.set(key, value),
      new Promise((_, reject) => setTimeout(() => reject(new Error('storage-timeout')), STORAGE_TIMEOUT_MS)),
    ]);
  } catch (error) {
    runtime().log?.warn?.('Host storage write timed out, using local fallback', { key, error: String(error) });
    await localStorageBackend.set(key, value);
  }
}

async function loadState() {
  try {
    historyItems = await loadHistory();
    const saved = await storageGet(STORAGE_KEY);
    if (saved) {
      state = ensureState(saved);
      if (isRecoverableWorkingOnlyState(state)) {
        state = createInitialState();
        await storageSet(STORAGE_KEY, { ...state, updatedAt: Date.now() });
      }
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
  await storageSet(STORAGE_KEY, { ...state, updatedAt: Date.now() });
  await saveHistorySnapshot(silent ? 'autosave' : 'manual');
  if (!silent) setStatus(t('saved'));
}

async function loadHistory() {
  try {
    const value = await storageGet(HISTORY_KEY);
    return Array.isArray(value) ? value.map(normalizeHistoryItem).filter(Boolean).slice(0, 40) : [];
  } catch (error) {
    runtime().log?.warn?.('Failed to load PPT Live history', { error: String(error) });
    return [];
  }
}

async function saveHistorySnapshot(reason = 'autosave') {
  if (!state?.slides?.length) return;
  if (isRecoverableWorkingOnlyState(state)) return;
  const now = Date.now();
  if (reason === 'autosave' && lastHistoryWriteAt && now - lastHistoryWriteAt < 15000) return;
  lastHistoryWriteAt = now;
  const item = normalizeHistoryItem({
    id: state.sessionId || uid('deck'),
    title: state.title || t('blankDeckTitle'),
    updatedAt: now,
    slideCount: state.slides.length,
    reason,
    prompt: state.brief?.topic || '',
    state: clone({ ...state, generation: { ...state.generation, active: false } }),
  });
  if (!item) return;
  historyItems = [item, ...historyItems.filter((entry) => entry.id !== item.id)].slice(0, 40);
  await storageSet(HISTORY_KEY, historyItems);
  renderHistory();
}

function isRecoverableWorkingOnlyState(value) {
  const slides = Array.isArray(value?.slides) ? value.slides : [];
  return slides.length === 1
    && !slides[0]?.html
    && String(slides[0]?.id || '').startsWith('agent-working-slide')
    && String(value?.title || '') === t('agentWorkingTitle')
    && !value?.generation?.active;
}

function normalizeHistoryItem(item) {
  if (!item?.id || !item?.state) return null;
  return {
    id: String(item.id),
    title: String(item.title || item.state?.title || t('blankDeckTitle')),
    updatedAt: Number(item.updatedAt || Date.now()),
    slideCount: Number(item.slideCount || item.state?.slides?.length || 0),
    reason: String(item.reason || 'autosave'),
    prompt: String(item.prompt || item.state?.brief?.topic || ''),
    state: item.state,
  };
}

function renderHistory() {
  const list = $('historyList');
  if (!list) return;
  list.innerHTML = '';
  if (!historyItems.length) {
    const empty = document.createElement('div');
    empty.className = 'history-empty';
    empty.textContent = t('historyEmpty');
    list.append(empty);
    return;
  }
  historyItems.slice(0, 12).forEach((item) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `history-card${item.id === state.sessionId ? ' is-active' : ''}`;
    button.innerHTML = `
      <strong>${escapeHtmlInline(item.title)}</strong>
      <span>${t('historyMeta', { count: item.slideCount, time: formatHistoryTime(item.updatedAt) })}</span>
      ${item.prompt ? `<small>${escapeHtmlInline(item.prompt)}</small>` : ''}
    `;
    button.addEventListener('click', () => void restoreHistory(item.id));
    list.append(button);
  });
}

async function restoreHistory(id) {
  const item = historyItems.find((entry) => entry.id === id);
  if (!item) return;
  deckEpoch += 1;
  await cancelTrackedBackendRuns();
  state = ensureState(clone(item.state));
  state.generation.active = false;
  resetGeneration();
  rerender();
  setStatus(t('historyRestored'));
  await storageSet(STORAGE_KEY, { ...state, updatedAt: Date.now() });
}

function formatHistoryTime(value) {
  try {
    return new Intl.DateTimeFormat([], { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(value));
  } catch {
    return '';
  }
}

function escapeHtmlInline(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
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
    if (node.id === 'newDeck') return;
    node.disabled = busy;
  });
  const pill = $('aiStatusPill');
  if (pill) {
    pill.textContent = busy ? t('statusPillBusy') : t('statusPillReady');
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
  renderGenerationOverlay(state);
  if (message) setStatus(message);
}

function resetGeneration() {
  state.generation.active = false;
  state.generation.current = 'idle';
  state.generation.draftedCount = 0;
  state.generation.slideTarget = 0;
  state.generation.steps = state.generation.steps.map((step) => ({ ...step, status: 'pending' }));
  state.generation.events = [];
  renderGeneration(state);
  renderGenerationOverlay(state);
}

function addGenerationEvent(event, detail = '', kind = 'info') {
  void event;
  void detail;
  void kind;
}

async function waitFrame() {
  await new Promise((resolve) => setTimeout(resolve, 120));
}

function rerender() {
  state = ensureState(state);
  renderAll(state, handlers);
  renderHistory();
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
  await handlePromptSubmit();
}

async function generateDeck() {
  await handlePromptSubmit();
}

async function generateDeckFromPrompt() {
  await handlePromptSubmit();
}

async function handlePromptSubmit() {
  if (promptSubmitGuard || backendRunInFlight) {
    return;
  }
  const instruction = promptValue();
  if (!instruction) {
    setStatus(t('promptRequired'));
    return;
  }
  promptSubmitGuard = true;
  updateBriefFromInputs();
  state.brief.topic = instruction;
  try {
    await runPptLiveBackend('auto', instruction);
    return;
  } catch (error) {
    if (isStoppedBackendError(error)) return;
    runtime().log?.warn?.('PPT Live backend generation failed', { error: String(error) });
    failGenerationUi(isTimeoutBackendError(error) ? t('generationTimedOut') : t('backendGenerationFailed'));
    rerender();
    await persist(true);
  } finally {
    promptSubmitGuard = false;
  }
}

function finishGenerationUi(statusMessage = t('deckReady')) {
  state.generation.active = false;
  state.generation.draftedCount = state.slides.length;
  state.generation.slideTarget = 0;
  state.generation.steps = (state.generation.steps || []).map((step) => ({
    ...step,
    status: step.status === 'error' ? 'error' : 'done',
  }));
  setStatus(statusMessage);
  renderGeneration(state);
  renderGenerationOverlay(state);
}

function failGenerationUi(statusMessage = t('backendGenerationFailed')) {
  state.generation.active = false;
  state.generation.steps = (state.generation.steps || []).map((step) => ({
    ...step,
    status: step.status === 'done' ? 'done' : 'error',
  }));
  setStatus(statusMessage);
  addGenerationEvent({ title: statusMessage, detail: t('agentOnlyRetryHint'), kind: 'error' });
  setBusy(false);
  renderGeneration(state);
  renderGenerationOverlay(state);
}

function buildGenerationStyle() {
  return {
    fontFamily: state.style?.fontFamily === 'serif' ? 'serif' : 'sans',
    density: normalizeDensity(state.style?.density),
    colorMode: state.style?.colorMode === 'dark' ? 'dark' : 'light',
  };
}

function pickDensityIndexFromClientX(clientX, track) {
  const rect = track.getBoundingClientRect();
  const ratio = clamp((clientX - rect.left) / rect.width, 0, 1);
  return Math.round(ratio * 2);
}

function setDensityIndex(index, { save = true } = {}) {
  const nextIndex = clamp(Math.round(Number(index)), 0, 2);
  state.style.density = indexToDensity(nextIndex);
  syncDensitySlider(state.style.density);
  const densityInput = $('densityInput');
  if (densityInput) densityInput.value = state.style.density;
  rerender();
  if (save) void persist(true);
}

async function runPptLiveBackend(operation, instruction) {
  const host = runtime();
  if (!host.backend?.call) throw new Error('PPT Live backend is unavailable');
  if (backendRunInFlight) {
    return;
  }
  backendRunInFlight = true;
  const runEpoch = deckEpoch;
  updateBriefFromInputs();
  const isInitialAutoDraft = operation === 'auto' && (isDefaultDraft() || isStarterDeck());
  const requestBrief = clone(state.brief);
  if (!requestBrief.slideTarget) delete requestBrief.slideTarget;
  const requestTitle = state.title;
  const requestOutline = isInitialAutoDraft ? [] : clone(state.outline);
  const requestSlideIndex = isInitialAutoDraft ? 0 : getActiveIndex(state);
  const requestDeck = isInitialAutoDraft ? null : {
    title: state.title,
    slides: clone(state.slides),
  };
  setBusy(true, t('working'));
  resetGeneration();
  setGenerationStep('brief', 'running', t('generationReadingBrief'));
  addGenerationEvent({ title: t('processEventStarted'), detail: t('processEventWaiting'), kind: 'start' });
  prepareAgentGenerationSurface(operation, instruction);
  let sessionId = null;
  let turnId = null;
  let textBuffer = '';
  let thinkingBuffer = '';
  let settled = false;
  let completed = false;
  const cleanup = [];
  const loggedToolEvents = new Set();
  const progressTracker = createGenerationProgressTracker();
  const lastStreamPhase = { value: '' };
  const waitForResult = new Promise((resolve, reject) => {
    const listener = (event) => {
      if (sessionId && event.sessionId && event.sessionId !== sessionId) return;
      if (turnId && event.turnId && event.turnId !== turnId) return;
      const sourceEvent = String(event.sourceEvent || '');
      if (sourceEvent.endsWith('dialog-turn-started')) {
        progressTracker.note(t('eventTurnStarted'), '', 'turn');
      } else if (sourceEvent.endsWith('model-round-started')) {
        setGenerationStep('spine', 'running', t('generationWritingClaims'));
        progressTracker.note(t('processEventRound'), '', 'phase');
      } else if (sourceEvent.endsWith('model-round-completed')) {
        progressTracker.note(t('eventRoundCompleted'), '', 'phase');
      } else if (sourceEvent.endsWith('tool-event')) {
        const toolEvent = normalizeToolEvent(event.toolEvent || {});
        const eventType = toolEvent.event_type || toolEvent.eventType || '';
        if (shouldLogToolEvent(toolEvent, loggedToolEvents)) {
          addGenerationEvent(describeToolEvent(event));
          progressTracker.touch();
        }
        if (eventType === 'EarlyDetected' || eventType === 'Started') {
          setGenerationStep('brief', 'running', t('generationReadingBrief'));
        } else if (eventType === 'Completed') {
          const toolName = String(toolEvent.tool_name || toolEvent.toolName || '').trim().toLowerCase();
          setGenerationStep('brief', 'done');
          setGenerationStep('spine', 'running', t('generationWritingClaims'));
          if (toolName === 'skill') {
            progressTracker.note(t('eventToolSkillReady'), friendlyToolName(toolEvent.tool_name || toolEvent.toolName), 'phase');
          }
        }
      } else if (sourceEvent.endsWith('text-chunk')) {
        const chunk = String(event.text || '');
        const isThinking = event.contentType === 'thinking';
        if (isThinking) thinkingBuffer += chunk;
        else textBuffer += chunk;
        if (!isThinking) noteTextStreamProgress(textBuffer, progressTracker, lastStreamPhase);
      } else if (sourceEvent.endsWith('token-usage-updated')) {
        // Keep token stats internal; do not surface them in the user-facing log.
      } else if (sourceEvent.endsWith('dialog-turn-completed')) {
        settled = true;
        addGenerationEvent({ title: t('generationParsingDeck'), detail: '', kind: 'parsing' });
        setStatus(t('generationParsingDeck'));
        resolve({ answer: textBuffer, thinking: thinkingBuffer });
      } else if (sourceEvent.endsWith('dialog-turn-failed') || sourceEvent.endsWith('dialog-turn-cancelled')) {
        settled = true;
        addGenerationEvent({
          title: sourceEvent.endsWith('dialog-turn-cancelled') ? t('eventTurnCancelled') : t('eventTurnFailed'),
          detail: compactText(event.error || ''),
          kind: 'error',
        });
        reject(new Error(sourceEvent));
      }
    };
    host.backend.onEvent(listener);
    cleanup.push(() => host.backend.offEvent?.(listener));
    const heartbeat = setInterval(() => {
      if (settled) return;
      const now = Date.now();
      if (now - progressTracker.lastProgressLogAt < 12000) return;
      const current = (state.generation?.steps || []).find((step) => step.status === 'running');
      progressTracker.note(current?.label ? `${current.label}…` : t('generationProgressPulse'), current?.detail || '', 'pulse', 0);
    }, 12000);
    cleanup.push(() => clearInterval(heartbeat));
  });

  try {
    const result = await host.backend.call('ppt.generate', {
      operation,
      instruction,
      locale: getLocale(),
      brief: requestBrief,
      title: requestTitle,
      outline: requestOutline,
      currentSlideIndex: requestSlideIndex,
      currentDeck: requestDeck,
      style: buildGenerationStyle(),
    }, {
      entityId: 'deck',
      idempotencyKey: `ppt-live-${Date.now()}`,
    });
    sessionId = result?.sessionId || null;
    turnId = result?.turnId || result?.actionRunId || null;
    if (sessionId && turnId) trackBackendRun(sessionId, turnId);
    if (isDeckEpochStale(runEpoch)) throw new Error('Generation stopped');
    setGenerationStep('brief', 'done');
    const streamed = await waitForResult;
    const streamedText = typeof streamed === 'string' ? streamed : streamed?.answer || '';
    const streamedThinking = typeof streamed === 'string' ? '' : streamed?.thinking || '';
    if (isDeckEpochStale(runEpoch)) throw new Error('Generation stopped');
    const finalText = await resolveBackendTurnText(sessionId, turnId, streamedText, streamedThinking);
    if (isDeckEpochStale(runEpoch)) throw new Error('Generation stopped');
    const payload = extractBackendJson(finalText);
    if (isDeckEpochStale(runEpoch)) throw new Error('Generation stopped');
    applyDeckPayload(payload);
    await saveHistorySnapshot(`agent:${operation}`);
    addGenerationEvent({ title: t('processEventDone'), detail: '', kind: 'done' });
    setGenerationStep('spine', 'done');
    setGenerationStep('proof', 'done');
    setGenerationStep('design', 'done');
    setGenerationStep('compile', 'done', t('generationCompiled'));
    finishGenerationUi(t('deckReady'));
    completed = true;
    rerender();
    await persist(true);
  } catch (error) {
    throw error;
  } finally {
    backendRunInFlight = false;
    cleanup.forEach((fn) => fn());
    if (sessionId && turnId) untrackBackendRun(sessionId, turnId);
    const ownsEpoch = !isDeckEpochStale(runEpoch);
    if (ownsEpoch) {
      if (state.generation.active && !completed) state.generation.active = false;
      setBusy(false);
    }
    renderGeneration(state);
    renderGenerationOverlay(state);
  }
}

function prepareAgentGenerationSurface(operation, instruction) {
  setStatus(t('generationAgentWorking'));
  addGenerationEvent({ title: t('generationAgentWorking'), detail: compactText(instruction || ''), kind: 'start' });
  if (operation === 'auto' && (isDefaultDraft() || isStarterDeck())) {
    state.title = t('agentWorkingTitle');
  }
  rerender();
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

const SILENT_TOOL_EVENT_TYPES = new Set([
  'ParamsPartial',
  'Queued',
  'Waiting',
  'Progress',
  'Streaming',
  'StreamChunk',
  'Confirmed',
  'Rejected',
]);

function friendlyToolName(name) {
  const raw = String(name || '').trim();
  if (!raw) return t('eventUnknownTool');
  if (/^skill$/i.test(raw)) return t('eventToolSkillName');
  return raw;
}

function shouldLogToolEvent(toolEvent, loggedToolEvents) {
  const normalized = normalizeToolEvent(toolEvent);
  const eventType = normalized.event_type || normalized.eventType || '';
  if (SILENT_TOOL_EVENT_TYPES.has(eventType)) return false;
  const toolId = normalized.tool_id || normalized.toolId || normalized.tool_name || normalized.toolName || 'tool';
  const key = `${toolId}:${eventType}`;
  if (loggedToolEvents.has(key)) return false;
  loggedToolEvents.add(key);
  return true;
}

function createGenerationProgressTracker() {
  let lastProgressLogAt = 0;
  let lastProgressTitle = '';
  return {
    get lastProgressLogAt() {
      return lastProgressLogAt;
    },
    touch() {
      lastProgressLogAt = Date.now();
    },
    note(title, detail = '', kind = 'phase', minIntervalMs = 0) {
      const now = Date.now();
      const sameTitle = title === lastProgressTitle;
      if (minIntervalMs > 0 && sameTitle && now - lastProgressLogAt < minIntervalMs) return false;
      lastProgressTitle = title;
      lastProgressLogAt = now;
      addGenerationEvent({ title, detail, kind });
      return true;
    },
  };
}

function inferGenerationPhaseFromBuffer(buffer) {
  const text = String(buffer || '');
  if (/"html"\s*:/.test(text)) return 'design';
  if (/"slides"\s*:/.test(text)) return 'proof';
  if (/"outline"\s*:/.test(text)) return 'spine';
  return 'spine';
}

function generationPhaseMessage(phase) {
  switch (phase) {
    case 'proof':
      return t('generationChoosingProof');
    case 'design':
      return t('generationDesigningLayouts');
    default:
      return t('generationWritingClaims');
  }
}

function extractJsonArraySection(text, key) {
  const pattern = new RegExp(`"${key}"\\s*:\\s*\\[`);
  const match = pattern.exec(String(text || ''));
  if (!match) return '';
  return String(text).slice(match.index + match[0].length);
}

function countJsonArrayObjects(section) {
  let depth = 0;
  let objects = 0;
  let inString = false;
  let escaped = false;
  for (let i = 0; i < section.length; i += 1) {
    const ch = section[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === '{') {
      if (depth === 0) objects += 1;
      depth += 1;
    } else if (ch === '}') {
      depth = Math.max(0, depth - 1);
    } else if (ch === ']' && depth === 0) {
      break;
    }
  }
  return objects;
}

function countJsonArrayStrings(section) {
  let depth = 0;
  let count = 0;
  let inString = false;
  let escaped = false;
  let stringAtArrayDepth = false;
  for (let i = 0; i < section.length; i += 1) {
    const ch = section[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') {
        inString = false;
        if (stringAtArrayDepth) count += 1;
        stringAtArrayDepth = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      stringAtArrayDepth = depth === 0;
      continue;
    }
    if (ch === '[') depth += 1;
    else if (ch === ']') {
      if (depth === 0) break;
      depth = Math.max(0, depth - 1);
    }
  }
  return count;
}

function estimateGenerationSlideCount(buffer, phase) {
  const text = String(buffer || '');
  let count = 0;

  if (phase === 'design') {
    count = (text.match(/"html"\s*:/g) || []).length;
  }
  if (count === 0 && (phase === 'design' || phase === 'proof')) {
    const slidesSection = extractJsonArraySection(text, 'slides');
    if (slidesSection) count = countJsonArrayObjects(slidesSection);
  }
  if (count === 0 && phase === 'spine') {
    const outlineSection = extractJsonArraySection(text, 'outline');
    if (outlineSection) count = countJsonArrayStrings(outlineSection);
  }

  return count;
}

function updateGenerationSlideProgress(buffer, phase) {
  const count = estimateGenerationSlideCount(buffer, phase);
  if (count > 0) state.generation.draftedCount = count;
  renderGeneration(state);
  renderGenerationOverlay(state);
}

function estimateGenerationDetail(buffer, phase) {
  const count = estimateGenerationSlideCount(buffer, phase);
  return count > 0 ? t('generationSlideProgress', { count }) : '';
}

function noteTextStreamProgress(buffer, progressTracker, lastPhaseRef) {
  const phase = inferGenerationPhaseFromBuffer(buffer);
  const title = generationPhaseMessage(phase);
  setGenerationStep(phase, 'running', title);
  updateGenerationSlideProgress(buffer, phase);
  progressTracker.touch();
  void lastPhaseRef;
}

function describeToolEvent(event) {
  const toolEvent = normalizeToolEvent(event.toolEvent || {});
  const eventType = toolEvent.event_type || toolEvent.eventType || 'ToolEvent';
  const toolName = friendlyToolName(toolEvent.tool_name || toolEvent.toolName);
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
  const namedTypes = new Set(['EarlyDetected', 'Started', 'Completed', 'Failed', 'Cancelled', 'ConfirmationNeeded']);
  return {
    title: labels[eventType] || t('processEventTool'),
    detail: namedTypes.has(eventType) ? toolName : userFacingToolDetail(eventType, toolEvent),
    kind: eventType === 'Failed' || eventType === 'Cancelled' || eventType === 'Rejected' ? 'error' : 'tool',
  };
}

function userFacingToolDetail(eventType, toolEvent) {
  if (eventType === 'Failed') return compactText(toolEvent.error || t('backendGenerationFailed'));
  if (eventType === 'Completed') return '';
  if (eventType === 'Progress') return compactText(toolEvent.message || '');
  return '';
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

function compactText(value, limit = 180) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  return text.length > limit ? `${text.slice(0, limit - 1)}...` : text;
}

function trackBackendRun(sessionId, turnId) {
  if (!sessionId || !turnId) return;
  const exists = backendRuns.some((run) => run.sessionId === sessionId && run.turnId === turnId);
  if (!exists) backendRuns.push({ sessionId, turnId });
}

function untrackBackendRun(sessionId, turnId) {
  backendRuns = backendRuns.filter((run) => !(run.sessionId === sessionId && run.turnId === turnId));
}

function isDeckEpochStale(epoch) {
  return epoch !== deckEpoch;
}

async function cancelTrackedBackendRuns() {
  const runs = [...backendRuns];
  backendRuns = [];
  if (!runs.length || !runtime().backend?.cancel) return;
  await Promise.all(runs.map(async (run) => {
    try {
      await runtime().backend.cancel(run.sessionId, run.turnId);
    } catch (error) {
      runtime().log?.warn?.('PPT Live backend cancel failed', {
        sessionId: run.sessionId,
        turnId: run.turnId,
        error: String(error),
      });
    }
  }));
}

async function stopAllBackendRuns(fromTimeout = false, options = {}) {
  const hadRuns = backendRuns.length > 0;
  await cancelTrackedBackendRuns();
  state.generation.active = false;
  state.generation.steps = state.generation.steps.map((step) => step.status === 'running' ? { ...step, status: 'error' } : step);
  if (!options.silent && hadRuns) {
    setStatus(fromTimeout ? t('generationTimedOut') : t('generationStopped'));
    addGenerationEvent(fromTimeout ? t('generationTimedOut') : t('generationStopped'));
  }
  setBusy(false);
  renderGeneration(state);
  renderGenerationOverlay(state);
  if (!options.silent) await persist(true);
}

async function stopBackendRun(fromTimeout = false) {
  await stopAllBackendRuns(fromTimeout);
}

function applyDeckPayload(payload) {
  const htmlSlides = normalizeHtmlSlides(payload);
  if (htmlSlides.length) {
    state.title = String(payload.title || state.title || t('blankDeckTitle'));
    state.slides = htmlSlides.map((slide, index) => normalizeSlide(slide, index, {
      ...state,
      slides: htmlSlides,
    }));
    state.outline = state.slides.map((slide) => slide.title);
    state.activeSlideId = state.slides[0]?.id || '';
    state.selectedElementId = '';
  } else if (!Array.isArray(payload?.slides) || payload.slides.length === 0) {
    throw new Error('PPT Live deck payload has no slides');
  } else {
    state.title = String(payload.title || state.title || t('blankDeckTitle'));
    state.slides = payload.slides.map((slide, index) => normalizeSlide({
      ...slide,
      html: slide.html || slide.sourceHtml || slide.slideHtml || '',
    }, index, {
      ...state,
      slides: payload.slides,
    }));
    state.outline = state.slides.map((slide) => slide.title);
    state.activeSlideId = state.slides[0]?.id || '';
    state.selectedElementId = state.slides[0]?.elements[0]?.id || '';
  }
  if (Array.isArray(payload.outline) && payload.outline.length) {
    state.outline = payload.outline.map(String);
  }
  if (payload.researchReport) {
    state.sources = {
      ...state.sources,
      facts: payload.researchReport.verifiedFacts || state.sources?.facts || [],
      warnings: payload.researchReport.warnings || state.sources?.warnings || [],
      summary: payload.researchReport.summary || state.sources?.summary || '',
      fetchedAt: Date.now(),
    };
  }
  if (payload.design?.palette && typeof payload.design.palette === 'object') {
    state.deckPalette = payload.design.palette;
  }
}

function normalizeHtmlSlides(payload) {
  const candidates = [];
  if (Array.isArray(payload?.htmlSlides)) candidates.push(...payload.htmlSlides);
  if (Array.isArray(payload?.slides)) candidates.push(...payload.slides.filter((slide) => slide?.html || slide?.sourceHtml || slide?.slideHtml));
  return candidates.map((slide, index) => {
    const html = String(slide?.html || slide?.sourceHtml || slide?.slideHtml || '').trim();
    if (!html) return null;
    return {
      id: slide.id || slide.slideId || uid('html-slide'),
      title: String(slide.title || slide.label || `${t('newSlideTitle')} ${index + 1}`),
      subtitle: String(slide.subtitle || ''),
      kicker: String(slide.kicker || ''),
      claim: String(slide.claim || slide.title || ''),
      proofObject: String(slide.proofObject || ''),
      supportNote: String(slide.supportNote || ''),
      sourceNote: String(slide.sourceNote || ''),
      notes: String(slide.notes || ''),
      layout: 'html',
      theme: slide.theme || {},
      html,
      elements: [],
    };
  }).filter(Boolean);
}

function pickParseableBackendText(...candidates) {
  for (const raw of candidates) {
    const text = String(raw || '').trim();
    if (!text) continue;
    try {
      extractBackendJson(text);
      return text;
    } catch {
      // try next candidate
    }
  }
  return String(candidates.find((raw) => String(raw || '').trim()) || '').trim();
}

async function resolveBackendTurnText(sessionId, turnId, streamedText, streamedThinking = '') {
  const startedAt = Date.now();
  const maxWaitMs = 25000;
  const answer = String(streamedText || '').trim();
  const thinking = String(streamedThinking || '').trim();
  const tryPick = () => pickParseableBackendText(answer, thinking, `${answer}\n${thinking}`.trim());
  let merged = tryPick();
  if (merged) {
    try {
      extractBackendJson(merged);
      return merged;
    } catch {
      // fall through to persisted turn text
    }
  }
  const host = runtime();
  if (!sessionId || !turnId || !host.backend?.turnText) {
    if (!merged) throw new Error('PPT Live backend produced no text');
    return merged;
  }
  let attempt = 0;
  while (Date.now() - startedAt < maxWaitMs && attempt < 8) {
    attempt += 1;
    try {
      const result = await Promise.race([
        host.backend.turnText(sessionId, turnId),
        new Promise((_, reject) => {
          setTimeout(() => reject(new Error('turnText timeout')), 4000);
        }),
      ]);
      const persisted = String(result?.text || '').trim();
      merged = pickParseableBackendText(persisted, merged, thinking, answer);
      if (merged) {
        extractBackendJson(merged);
        return merged;
      }
    } catch (error) {
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  if (!merged) throw new Error('PPT Live backend produced no text');
  return merged;
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

function isTimeoutBackendError(error) {
  const message = String(error || '');
  return message.includes('timed out');
}

function isStoppedBackendError(error) {
  const message = String(error || '');
  return message.includes('dialog-turn-cancelled')
    || message.includes('Generation stopped');
}

async function applyAiAction(action, options = {}) {
  if (options.readBrief !== false) updateBriefFromInputs();
  const instruction = [action, promptValue()].filter(Boolean).join(': ');
  if (!instruction) {
    setStatus(t('promptRequired'));
    return;
  }
  try {
    await runPptLiveBackend('revise_slide', instruction);
  } catch (error) {
    if (isStoppedBackendError(error)) return;
    runtime().log?.warn?.('PPT Live backend slide revision failed', { action, error: String(error) });
    failGenerationUi(isTimeoutBackendError(error) ? t('generationTimedOut') : t('backendGenerationFailed'));
    await persist(true);
  }
}

async function reviseCurrentSlide() {
  await applyAiAction('redesign', { readBrief: false });
}

async function reviseDeck() {
  const instruction = promptValue();
  if (!instruction) {
    setStatus(t('promptRequired'));
    return;
  }
  updateBriefFromInputs();
  try {
    await runPptLiveBackend('revise_deck', instruction);
    return;
  } catch (error) {
    if (isStoppedBackendError(error)) return;
    runtime().log?.warn?.('PPT Live backend revision failed', { error: String(error) });
    failGenerationUi(isTimeoutBackendError(error) ? t('generationTimedOut') : t('backendGenerationFailed'));
    await persist(true);
  }
}

async function insertSlideFromPrompt() {
  const instruction = promptValue();
  if (!instruction) {
    setStatus(t('promptRequired'));
    return;
  }
  try {
    await runPptLiveBackend('insert_slide', instruction);
  } catch (error) {
    if (isStoppedBackendError(error)) return;
    runtime().log?.warn?.('PPT Live backend insert slide failed', { error: String(error) });
    failGenerationUi(isTimeoutBackendError(error) ? t('generationTimedOut') : t('backendGenerationFailed'));
    await persist(true);
  }
}

async function deleteSlideFromPrompt() {
  const instruction = promptValue() || t('deleteSlideDefaultPrompt');
  if (state.slides.length <= 1) {
    setStatus(t('cannotDelete'));
    return;
  }
  try {
    await runPptLiveBackend('delete_slide', instruction);
  } catch (error) {
    if (isStoppedBackendError(error)) return;
    runtime().log?.warn?.('PPT Live backend delete slide failed', { error: String(error) });
    failGenerationUi(isTimeoutBackendError(error) ? t('generationTimedOut') : t('backendGenerationFailed'));
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

async function newDeck() {
  deckEpoch += 1;
  await saveHistorySnapshot('before-new');
  await cancelTrackedBackendRuns();
  state.generation.active = false;
  setBusy(false);
  state = createBlankDeckState();
  resetGeneration();
  rerender();
  setStatus(t('blankDeckReady'));
  await persist(true);
}

function createBlankDeckState() {
  return ensureState(createInitialState());
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
  if ($('presentCounter')) $('presentCounter').textContent = `${Math.max(1, state.presentIndex + 1)} / ${Math.max(1, state.slides.length)}`;
  fitSlideCanvas();
}

function movePresent(delta) {
  state.presentIndex = clamp(state.presentIndex + delta, 0, state.slides.length - 1);
  renderPresent();
}

function exportHtml() {
  if (!(state.slides || []).length) {
    setExportStatus(t('exportDeckEmpty'));
    return null;
  }
  updateBriefFromInputs();
  const filename = downloadHtmlDeck(state);
  setExportStatus(t('exportSavedTo', { path: filename }));
  return filename;
}

function ensureExportableDeck() {
  updateBriefFromInputs();
  if (!(state.slides || []).length) {
    setExportStatus(t('exportDeckEmpty'));
    return false;
  }
  return true;
}

function getExportLabels(format) {
  const labels = {
    html: {
      working: t('exportHtmlWorking'),
      done: t('exportHtmlDone'),
      failed: t('exportHtmlFailed'),
    },
    pptx: {
      working: t('exportPptxWorking'),
      done: t('exportPptxDone'),
      failed: t('exportPptxFailed'),
    },
    pdf: {
      working: t('exportPdfWorking'),
      done: t('exportPdfDone'),
      failed: t('exportPdfFailed'),
    },
    png: {
      working: t('exportPngWorking'),
      done: t('exportPngDone'),
      failed: t('exportPngFailed'),
    },
  };
  return labels[format] || null;
}

async function executeExport(format) {
  if (format === 'html') {
    updateBriefFromInputs();
    const filename = downloadHtmlDeck(state);
    if (!filename) throw new Error(t('exportDeckEmpty'));
    return { filename };
  }
  const methodMap = {
    pptx: 'exportPptx',
    pdf: 'exportPdf',
    png: 'exportPng',
  };
  const method = methodMap[format];
  if (!method) throw new Error(t('exportFormatUnavailable'));
  const result = await runtime().call(method, { deck: clone(state) });
  const base64 = typeof result?.base64 === 'string'
    ? result.base64.replace(/^data:.*;base64,/, '')
    : '';
  if (!base64) throw new Error(`${method} returned no data`);
  const filename = result.filename || `${fileSafe(state.title || 'ppt-live')}`;
  downloadBase64File(
    base64,
    filename,
    result.mimeType || 'application/octet-stream',
  );
  return { filename };
}

async function exportFromWorker(method, labels) {
  if (exportInFlight) return null;
  if (!ensureExportableDeck()) return null;
  exportInFlight = true;
  try {
    const format = method.replace(/^export/, '').toLowerCase();
    const { filename } = await executeExport(format);
    setExportStatus(t('exportSavedTo', { path: filename }));
    return filename;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    runtime().log?.error?.(`PPT Live ${method} export failed`, { error: message });
    const hint = /unknown method|cannot find module|install|dependency/i.test(message)
      ? ` ${t('installDepsHint')}`
      : '';
    setExportStatus(`${labels.failed} ${message}${hint}`);
    return null;
  } finally {
    exportInFlight = false;
  }
}

let exportInFlight = false;

async function exportPptx() {
  await exportFromWorker('exportPptx', {
    working: t('exportPptxWorking'),
    done: t('exportPptxDone'),
    failed: t('exportPptxFailed'),
  });
}

async function exportPdf() {
  await exportFromWorker('exportPdf', {
    working: t('exportPdfWorking'),
    done: t('exportPdfDone'),
    failed: t('exportPdfFailed'),
  });
}

async function exportPng() {
  await exportFromWorker('exportPng', {
    working: t('exportPngWorking'),
    done: t('exportPngDone'),
    failed: t('exportPngFailed'),
  });
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
  updateElementTextDirect(id, value) {
    const slide = getActiveSlide(state);
    const element = slide?.elements.find((item) => item.id === id);
    if (!element) return;
    element.text = String(value || '').trim();
    updateSlideTitleFromElements(slide);
    renderThumbs(state, handlers);
    renderOutline(state, handlers);
    void persist(false);
  },
  updateElementListItemDirect(id, index, value) {
    const slide = getActiveSlide(state);
    const element = slide?.elements.find((item) => item.id === id);
    if (!element || !Array.isArray(element.items)) return;
    element.items[index] = String(value || '').trim();
    element.items = element.items.filter(Boolean);
    renderSlideCanvas(state, handlers);
    renderThumbs(state, handlers);
    void persist(false);
  },
  updateSlideHtmlDirect(id, html) {
    const slide = state.slides.find((item) => item.id === id);
    if (!slide) return;
    slide.html = String(html || '');
    void persist(false);
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

function bindPanelResizers() {
  const shell = document.querySelector('.studio-shell');
  if (!shell) return;
  const root = document.documentElement;
  const storedFilmstrip = Number(safeLocalStorageGet('pptLiveFilmstripWidth') || 0);
  const storedAgent = Number(safeLocalStorageGet('pptLiveAgentWidth') || 0);
  if (storedFilmstrip >= 128 && storedFilmstrip <= 360) {
    root.style.setProperty('--filmstrip-width', `${storedFilmstrip}px`);
  }
  if (storedAgent >= 240 && storedAgent <= 460) {
    root.style.setProperty('--agent-width', `${storedAgent}px`);
  }

  const dragPanel = (side, startX) => {
    const rect = shell.getBoundingClientRect();
    const minFilmstrip = 128;
    const maxFilmstrip = Math.min(360, rect.width * 0.34);
    const minAgent = 240;
    const maxAgent = Math.min(460, rect.width * 0.42);
    const minStage = 360;
    const onMove = (event) => {
      if (side === 'filmstrip') {
        const next = Math.max(minFilmstrip, Math.min(maxFilmstrip, event.clientX - rect.left));
        if (rect.width - next - parseFloat(getComputedStyle(root).getPropertyValue('--agent-width')) - 12 < minStage) return;
        root.style.setProperty('--filmstrip-width', `${next}px`);
      } else {
        const next = Math.max(minAgent, Math.min(maxAgent, rect.right - event.clientX));
        if (rect.width - next - parseFloat(getComputedStyle(root).getPropertyValue('--filmstrip-width')) - 12 < minStage) return;
        root.style.setProperty('--agent-width', `${next}px`);
      }
    };
    const onUp = () => {
      shell.classList.remove('is-resizing');
      document.querySelectorAll('.panel-resizer.is-dragging').forEach((node) => node.classList.remove('is-dragging'));
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      safeLocalStorageSet('pptLiveFilmstripWidth', String(parseFloat(getComputedStyle(root).getPropertyValue('--filmstrip-width')) || ''));
      safeLocalStorageSet('pptLiveAgentWidth', String(parseFloat(getComputedStyle(root).getPropertyValue('--agent-width')) || ''));
      fitSlideCanvas();
      fitThumbPreviews();
    };
    shell.classList.add('is-resizing');
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp, { once: true });
    window.addEventListener('pointercancel', onUp, { once: true });
    onMove({ clientX: startX });
  };

  $('filmstripResizer')?.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.classList.add('is-dragging');
    dragPanel('filmstrip', event.clientX);
  });
  $('agentResizer')?.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.classList.add('is-dragging');
    dragPanel('agent', event.clientX);
  });
}

function bindEvents() {
  let resizeTimer = null;
  const scheduleCanvasFit = () => {
    if (resizeTimer) clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      fitSlideCanvas();
      fitThumbPreviews();
    }, 60);
  };
  window.addEventListener('resize', scheduleCanvasFit);

  $('toggleFilmstrip')?.addEventListener('click', () => {
    const filmstrip = $('filmstrip');
    const resizer = $('filmstripResizer');
    if (!filmstrip) return;
    const collapsed = filmstrip.classList.toggle('is-collapsed');
    if (resizer) resizer.hidden = collapsed;
    const toggle = $('toggleFilmstrip');
    if (toggle) toggle.textContent = collapsed ? '›' : '‹';
    scheduleCanvasFit();
  });

  $('toggleHistory')?.addEventListener('click', () => {
    const drawer = $('historyDrawer');
    if (!drawer) return;
    drawer.hidden = !drawer.hidden;
  });
  $('closeHistory')?.addEventListener('click', () => {
    const drawer = $('historyDrawer');
    if (drawer) drawer.hidden = true;
  });
  document.querySelectorAll('[data-sidebar-tab]').forEach((button) => {
    button.addEventListener('click', () => {
      const tab = button.dataset.sidebarTab;
      document.querySelectorAll('[data-sidebar-tab]').forEach((node) => {
        node.classList.toggle('is-active', node.dataset.sidebarTab === tab);
      });
      document.querySelectorAll('[data-sidebar-panel]').forEach((node) => {
        node.classList.toggle('is-active', node.dataset.sidebarPanel === tab);
      });
    });
  });

  ['topicInput', 'audienceInput', 'materialInput', 'deckTypeInput', 'toneInput', 'densityInput', 'brandPrimaryInput', 'brandAccentInput', 'imagePolicyInput'].forEach((id) => {
    $(id)?.addEventListener('input', () => {
      updateBriefFromInputs();
      if (['densityInput', 'brandPrimaryInput', 'brandAccentInput'].includes(id)) restyleDeck();
      else void persist(true);
    });
  });
  $('newDeck')?.addEventListener('click', () => void newDeck());
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
  $('restyleDeck')?.addEventListener('click', restyleDeck);
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

  try {
    bindPanelResizers();
  } catch (error) {
    runtime().log?.warn?.('Failed to bind PPT Live panel resizers', { error: String(error) });
  }
  if (typeof ResizeObserver !== 'undefined') {
    const shell = document.querySelector('.studio-shell');
    if (shell) new ResizeObserver(scheduleCanvasFit).observe(shell);
    const canvasArea = document.querySelector('.canvas-area');
    if (canvasArea) new ResizeObserver(scheduleCanvasFit).observe(canvasArea);
  }

  /* === New v2 UI interactions === */
  bindCanvasZoom();
  bindFloatingToolbar();
  bindPropertyPanels();
  bindExportModal();
  bindHostTheme();
}

/* ============================================
   CANVAS ZOOM
   ============================================ */
let currentZoom = 1;
const ZOOM_STEP = 0.25;
const ZOOM_MIN = 0.25;
const ZOOM_MAX = 2.0;

function setCanvasZoom(zoom) {
  currentZoom = clamp(zoom, ZOOM_MIN, ZOOM_MAX);
  const stage = document.querySelector('.canvas-stage');
  if (stage) stage.style.transform = currentZoom === 1 ? '' : `scale(${currentZoom})`;
  const zoomValue = $('zoomValue');
  const statusZoomValue = $('statusZoomValue');
  const pct = Math.round(currentZoom * 100) + '%';
  if (zoomValue) zoomValue.textContent = pct;
  if (statusZoomValue) statusZoomValue.textContent = pct;
}

function bindCanvasZoom() {
  $('zoomIn')?.addEventListener('click', () => setCanvasZoom(currentZoom + ZOOM_STEP));
  $('zoomOut')?.addEventListener('click', () => setCanvasZoom(currentZoom - ZOOM_STEP));
  $('statusZoomIn')?.addEventListener('click', () => setCanvasZoom(currentZoom + ZOOM_STEP));
  $('statusZoomOut')?.addEventListener('click', () => setCanvasZoom(currentZoom - ZOOM_STEP));
  document.querySelector('.canvas-area')?.addEventListener('wheel', (e) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const delta = e.deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP;
      setCanvasZoom(currentZoom + delta);
    }
  }, { passive: false });
}

/* ============================================
   FLOATING TOOLBAR
   ============================================ */
function bindFloatingToolbar() {
  const toolbar = $('floatingToolbar');
  if (!toolbar) return;
  document.querySelectorAll('.floating-toolbar-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const tool = btn.dataset.tool;
      if (!tool) return;
      const slide = getActiveSlide(state);
      const element = getSelectedElement(state);
      if (!slide || !element) return;
      switch (tool) {
        case 'bold':
          element.fontWeight = element.fontWeight === '700' ? '400' : '700';
          break;
        case 'italic':
          element.fontStyle = element.fontStyle === 'italic' ? 'normal' : 'italic';
          break;
        case 'underline':
          element.textDecoration = element.textDecoration === 'underline' ? 'none' : 'underline';
          break;
        case 'align-left': element.align = 'left'; break;
        case 'align-center': element.align = 'center'; break;
        case 'align-right': element.align = 'right'; break;
        case 'duplicate':
          slide.elements.push({ ...clone(element), id: uid('el'), x: element.x + 5, y: element.y + 5 });
          break;
        case 'delete':
          slide.elements = slide.elements.filter((el) => el.id !== element.id);
          state.selectedElementId = null;
          break;
      }
      renderSlideCanvas(state, handlers);
      renderThumbs(state, handlers);
      void persist(true);
    });
  });
}

/* ============================================
   COLLAPSIBLE PROPERTY PANELS
   ============================================ */
function bindPropertyPanels() {
  document.querySelectorAll('.property-section__header').forEach((header) => {
    const section = header.closest('.property-section');
    if (!section) return;
    const toggle = () => {
      section.classList.toggle('is-collapsed');
      const expanded = !section.classList.contains('is-collapsed');
      header.setAttribute('aria-expanded', String(expanded));
    };
    header.addEventListener('click', toggle);
    header.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); }
    });
  });

  /* Density slider (3 snap points) */
  const densitySlider = $('densitySlider');
  const densityTrack = densitySlider?.querySelector('.density-slider__track');
  if (densitySlider && densityTrack) {
    densityTrack.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      setDensityIndex(pickDensityIndexFromClientX(event.clientX, densityTrack));
      densityTrack.setPointerCapture(event.pointerId);
    });
    densityTrack.addEventListener('pointermove', (event) => {
      if (!densityTrack.hasPointerCapture(event.pointerId)) return;
      setDensityIndex(pickDensityIndexFromClientX(event.clientX, densityTrack), { save: false });
    });
    densityTrack.addEventListener('pointerup', (event) => {
      if (!densityTrack.hasPointerCapture(event.pointerId)) return;
      densityTrack.releasePointerCapture(event.pointerId);
      void persist(true);
    });
    densityTrack.addEventListener('pointercancel', (event) => {
      if (!densityTrack.hasPointerCapture(event.pointerId)) return;
      densityTrack.releasePointerCapture(event.pointerId);
      void persist(true);
    });
    densitySlider.querySelectorAll('[data-density-index]').forEach((tick) => {
      tick.addEventListener('click', (event) => {
        event.stopPropagation();
        setDensityIndex(tick.dataset.densityIndex);
      });
    });
    densitySlider.addEventListener('keydown', (event) => {
      const currentIndex = densityToIndex(state.style.density);
      if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') {
        event.preventDefault();
        setDensityIndex(currentIndex - 1);
      } else if (event.key === 'ArrowRight' || event.key === 'ArrowUp') {
        event.preventDefault();
        setDensityIndex(currentIndex + 1);
      } else if (event.key === 'Home') {
        event.preventDefault();
        setDensityIndex(0);
      } else if (event.key === 'End') {
        event.preventDefault();
        setDensityIndex(2);
      }
    });
  }

  /* Font family */
  document.querySelectorAll('[data-font-family]').forEach((button) => {
    button.addEventListener('click', () => {
      state.style.fontFamily = button.dataset.fontFamily === 'serif' ? 'serif' : 'sans';
      document.querySelectorAll('[data-font-family]').forEach((node) => {
        const active = node === button;
        node.classList.toggle('is-active', active);
        node.setAttribute('aria-pressed', active ? 'true' : 'false');
      });
      restyleDeck();
    });
  });

  /* Slide color mode */
  document.querySelectorAll('[data-color-mode]').forEach((button) => {
    button.addEventListener('click', () => {
      state.style.colorMode = button.dataset.colorMode === 'dark' ? 'dark' : 'light';
      document.querySelectorAll('[data-color-mode]').forEach((node) => {
        const active = node === button;
        node.classList.toggle('is-active', active);
        node.setAttribute('aria-pressed', active ? 'true' : 'false');
      });
      void persist(true);
    });
  });
}

/* ============================================
   EXPORT MODAL
   ============================================ */
let exportPreviewIndex = 0;

function getSelectedExportFormat() {
  return $('formatGrid')?.querySelector('.format-card.is-selected')?.dataset.format || 'pptx';
}

function openExportModal() {
  const overlay = $('exportOverlay');
  if (!overlay) return;
  resetExportModalFeedback();
  exportPreviewIndex = Math.max(0, getActiveIndex(state));
  overlay.classList.add('is-visible');
  overlay.setAttribute('aria-hidden', 'false');
  renderExportFormats();
  updateExportPreview();
  requestAnimationFrame(() => fitExportPreview());
}

function fitExportPreview() {
  fitExportPreviewFrame($('exportPreviewFrame'));
}

function resetExportModalFeedback() {
  const feedback = $('exportModalFeedback');
  const text = $('exportModalFeedbackText');
  const spinner = $('exportModalSpinner');
  $('exportOverlay')?.classList.remove('is-exporting');
  if (feedback) {
    feedback.hidden = true;
    feedback.classList.remove('is-success', 'is-error');
  }
  if (text) text.textContent = '';
  if (spinner) spinner.hidden = false;
  setExportModalBusy(false);
}

function setExportModalBusy(nextBusy) {
  ['exportCancel', 'exportConfirm', 'closeExport'].forEach((id) => {
    const node = $(id);
    if (node) node.disabled = nextBusy;
  });
  $('formatGrid')?.querySelectorAll('.format-card').forEach((card) => {
    card.tabIndex = nextBusy ? -1 : 0;
    card.style.pointerEvents = nextBusy ? 'none' : '';
  });
  ['exportPreviewPrev', 'exportPreviewNext'].forEach((id) => {
    const node = $(id);
    if (node) node.disabled = nextBusy;
  });
}

function setExportModalFeedback(mode, message) {
  const feedback = $('exportModalFeedback');
  const text = $('exportModalFeedbackText');
  const spinner = $('exportModalSpinner');
  if (!feedback || !text) return;
  feedback.hidden = false;
  feedback.classList.toggle('is-success', mode === 'success');
  feedback.classList.toggle('is-error', mode === 'error');
  if (spinner) spinner.hidden = mode !== 'loading';
  text.textContent = message;
}

function closeExportModal() {
  const overlay = $('exportOverlay');
  if (!overlay) return;
  overlay.classList.remove('is-visible');
  overlay.setAttribute('aria-hidden', 'true');
  resetExportModalFeedback();
}

function renderExportFormats() {
  const grid = $('formatGrid');
  if (!grid) return;
  const formats = [
    { id: 'pptx', name: 'PPTX', desc: 'Editable PowerPoint' },
    { id: 'pdf', name: 'PDF', desc: 'Universal format' },
    { id: 'html', name: 'HTML', desc: 'Interactive web deck' },
    { id: 'png', name: 'PNG', desc: 'Image sequence' },
  ];
  grid.innerHTML = formats.map((f, i) => `
    <div class="format-card ${i === 0 ? 'is-selected' : ''}" data-format="${f.id}"
      role="button" tabindex="0" aria-label="Export as ${f.name}"
    >
      <div class="format-card__icon" style="background:${exportFormatTone(f.id)}">${exportFormatIcon(f.id)}</div>
      <span class="format-card__name">${f.name}</span>
      <span class="format-card__desc">${f.desc}</span>
    </div>
  `).join('');
  grid.querySelectorAll('.format-card').forEach((card) => {
    const select = () => {
      grid.querySelectorAll('.format-card').forEach((c) => c.classList.remove('is-selected'));
      card.classList.add('is-selected');
      updateExportPreview();
    };
    card.addEventListener('click', select);
    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select(); }
    });
  });
}

function mountExportPreviewSlide(frame, slide) {
  if (!frame || !slide) return;
  frame.innerHTML = '';
  const viewport = document.createElement('div');
  viewport.className = 'export-preview__viewport';
  const scaleWrap = document.createElement('div');
  scaleWrap.className = 'export-preview__scale';
  if (slide.html) {
    scaleWrap.appendChild(buildExportPreviewStage(slide.html));
  } else {
    const stage = document.createElement('div');
    stage.className = 'export-preview__element-stage';
    stage.innerHTML = slideHtml(slide);
    scaleWrap.append(stage);
  }
  viewport.append(scaleWrap);
  frame.append(viewport);
  requestAnimationFrame(() => {
    fitExportPreview();
    requestAnimationFrame(() => fitExportPreview());
  });
}

function updateExportPreview() {
  const info = $('exportPreviewInfo');
  const counter = $('exportPreviewCounter');
  const frame = $('exportPreviewFrame');
  const slides = state.slides || [];
  const format = getSelectedExportFormat().toUpperCase();
  const total = Math.max(1, slides.length);
  exportPreviewIndex = clamp(exportPreviewIndex, 0, Math.max(0, slides.length - 1));
  if (info) info.textContent = `${format} · ${slides.length} slides`;
  if (counter) counter.textContent = `${exportPreviewIndex + 1} / ${total}`;
  if (!frame) return;
  const slide = slides[exportPreviewIndex];
  if (!slide) {
    frame.innerHTML = `<div class="export-preview__empty">${escapeHtml(t('slidesEmptyHint'))}</div>`;
    return;
  }
  mountExportPreviewSlide(frame, slide);
}

async function confirmExportFromModal() {
  if (exportInFlight) return;
  if (!ensureExportableDeck()) return;
  const format = getSelectedExportFormat();
  const labels = getExportLabels(format);
  if (!labels) {
    setExportStatus(t('exportFormatUnavailable'));
    return;
  }

  exportInFlight = true;
  $('exportOverlay')?.classList.add('is-exporting');
  setExportModalBusy(true);
  setExportModalFeedback('loading', labels.working);
  try {
    const { filename } = await executeExport(format);
    const savedMessage = t('exportSavedTo', { path: filename });
    $('exportOverlay')?.classList.remove('is-exporting');
    setExportModalFeedback('success', savedMessage);
    setExportStatus(savedMessage);
    await new Promise((resolve) => setTimeout(resolve, 1600));
    closeExportModal();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    runtime().log?.error?.(`PPT Live ${format} export failed`, { error: message });
    const hint = /unknown method|cannot find module|install|dependency/i.test(message)
      ? ` ${t('installDepsHint')}`
      : '';
    $('exportOverlay')?.classList.remove('is-exporting');
    setExportModalFeedback('error', `${labels.failed} ${message}${hint}`);
    setExportStatus(`${labels.failed} ${message}${hint}`);
    setExportModalBusy(false);
  } finally {
    exportInFlight = false;
  }
}

function bindExportModal() {
  $('exportPptx')?.addEventListener('click', () => openExportModal());
  $('closeExport')?.addEventListener('click', closeExportModal);
  $('exportCancel')?.addEventListener('click', closeExportModal);
  $('exportConfirm')?.addEventListener('click', () => { void confirmExportFromModal(); });
  $('exportOverlay')?.addEventListener('click', (e) => {
    if (e.target === $('exportOverlay') && !exportInFlight) closeExportModal();
  });
  $('exportPreviewPrev')?.addEventListener('click', () => {
    exportPreviewIndex = Math.max(0, exportPreviewIndex - 1);
    updateExportPreview();
    requestAnimationFrame(() => fitExportPreview());
  });
  $('exportPreviewNext')?.addEventListener('click', () => {
    const max = (state.slides || []).length - 1;
    exportPreviewIndex = Math.min(max, exportPreviewIndex + 1);
    updateExportPreview();
    requestAnimationFrame(() => fitExportPreview());
  });
  if (typeof ResizeObserver !== 'undefined') {
    const previewFrame = $('exportPreviewFrame');
    if (previewFrame) {
      new ResizeObserver(() => {
        if ($('exportOverlay')?.classList.contains('is-visible')) fitExportPreview();
      }).observe(previewFrame);
    }
  }
}

/* ============================================
   HOST THEME — follow Sparo light/dark
   ============================================ */
const THEME_STORAGE_KEY = 'pptLiveTheme';

function resolveTheme(theme) {
  if (theme === 'dark' || theme === 'light') return theme;
  if (window.matchMedia?.('(prefers-color-scheme: dark)')?.matches) return 'dark';
  return 'light';
}

function getHostTheme() {
  const hostTheme = runtime().theme;
  if (hostTheme === 'dark' || hostTheme === 'light') return hostTheme;
  return resolveTheme();
}

function applyTheme(theme) {
  const resolved = resolveTheme(theme);
  const root = document.documentElement;
  root.setAttribute('data-theme', resolved);
  root.setAttribute('data-theme-type', resolved);
  root.style.colorScheme = resolved;
  fitSlideCanvas();
  fitThumbPreviews();
}

function bindHostTheme() {
  try {
    localStorage.removeItem(THEME_STORAGE_KEY);
  } catch {
    memoryStorage.delete(THEME_STORAGE_KEY);
  }
  applyTheme(getHostTheme());
  runtime().onThemeChange?.((payload) => {
    const next = payload?.type === 'dark' ? 'dark' : 'light';
    applyTheme(next);
  });
}

async function recoverFromRestart() {
  deckEpoch += 1;
  backendRuns = [];
  backendRunInFlight = false;
  promptSubmitGuard = false;
  if (state.generation?.active || state.generation?.steps?.some((step) => step.status === 'running')) {
    finishGenerationUi(t('generationStopped'));
    resetGeneration();
  }
  setBusy(false);
  const host = runtime();
  if (host.backend?.cancelStaleRuns) {
    void host.backend.cancelStaleRuns().catch((error) => {
      runtime().log?.warn?.('Failed to cancel stale PPT Live backend runs', { error: String(error) });
    });
  }
}

function syncLocale() {
  state.generation = normalizeGeneration(state.generation);
  applyI18n();
  syncDensitySlider(state.style?.density);
  const pill = $('aiStatusPill');
  if (pill) pill.textContent = busy ? t('statusPillBusy') : t('statusPillReady');
  rerender();
}

async function init() {
  syncLocale();
  try {
    await loadState();
    await recoverFromRestart();
    syncLocale();
    await persist(true);
  } catch (error) {
    runtime().log?.error?.('PPT Live init failed', { error: String(error) });
    setStatus(t('ready'));
    syncLocale();
  }
}

bindEvents();
observeThumbPreviews();
runtime().onLocaleChange?.(() => syncLocale());
init();
