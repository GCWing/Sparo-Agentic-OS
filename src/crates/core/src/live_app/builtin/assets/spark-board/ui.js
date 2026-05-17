import { STRINGS } from './src/i18n.js';
import { DEFAULT_CARDS, SCHEMA_VERSION, clone } from './src/state.js';

let state = {
  schemaVersion: SCHEMA_VERSION,
  boards: [],
  activeBoardId: 'board-default',
  boardTitle: 'First sparks',
  cards: clone(DEFAULT_CARDS),
  selectedIds: [],
  connections: [],
  draft: '',
  mode: 'free',
  outputFormat: 'message',
  pendingPreview: null
};

let dragState = null;
let busy = false;

const $ = (id) => document.getElementById(id);
const runtime = () => window.app || {};
const locale = () => runtime().locale || 'en-US';
const t = (key) => (STRINGS[locale()] || STRINGS['en-US'])[key] || STRINGS['en-US'][key] || key;
const uid = (prefix = 'card') => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

function appStorage() {
  const host = runtime();
  if (host.storage) return host.storage;
  return {
    get: async (key) => JSON.parse(localStorage.getItem(key) || 'null'),
    set: async (key, value) => localStorage.setItem(key, JSON.stringify(value))
  };
}

function applyI18n() {
  document.querySelectorAll('[data-i18n]').forEach((node) => { node.textContent = t(node.dataset.i18n); });
  document.querySelectorAll('[data-i18n-placeholder]').forEach((node) => { node.placeholder = t(node.dataset.i18nPlaceholder); });
  renderLanes();
}

function setStatus(message) {
  $('statusLine').textContent = message;
}

function setBusy(nextBusy) {
  busy = nextBusy;
  document.querySelectorAll('button').forEach((button) => { button.disabled = busy; });
  updateSelectionMeta();
}

function buildBoardSnapshot(id = state.activeBoardId, title = state.boardTitle) {
  return {
    id,
    title: title || t('untitledBoard'),
    cards: clone(state.cards || []),
    connections: clone(state.connections || []),
    draft: state.draft || '',
    mode: state.mode || 'free',
    outputFormat: state.outputFormat || 'message',
    schemaVersion: SCHEMA_VERSION,
    updatedAt: Date.now()
  };
}

function normalizeBoard(board) {
  return {
    id: board.id || uid('board'),
    title: board.title || t('untitledBoard'),
    cards: Array.isArray(board.cards) ? board.cards : [],
    connections: Array.isArray(board.connections) ? board.connections : [],
    draft: typeof board.draft === 'string' ? board.draft : '',
    mode: board.mode || 'free',
    outputFormat: board.outputFormat || 'message',
    schemaVersion: SCHEMA_VERSION,
    updatedAt: board.updatedAt || Date.now()
  };
}

function ensureBoards() {
  state.boards = (Array.isArray(state.boards) ? state.boards : []).map(normalizeBoard);
  if (!Array.isArray(state.boards) || state.boards.length === 0) {
    state.boards = [buildBoardSnapshot('board-default', state.boardTitle || t('defaultBoardTitle'))];
    state.activeBoardId = state.boards[0].id;
  }
  if (!state.boards.some((board) => board.id === state.activeBoardId)) {
    state.activeBoardId = state.boards[0].id;
  }
}

function persistCurrentBoard() {
  ensureBoards();
  const index = state.boards.findIndex((board) => board.id === state.activeBoardId);
  const snapshot = buildBoardSnapshot(state.activeBoardId, state.boardTitle);
  if (index >= 0) state.boards[index] = snapshot;
  else state.boards.unshift(snapshot);
}

function applyBoard(board) {
  state.activeBoardId = board.id;
  state.boardTitle = board.title || t('untitledBoard');
  state.cards = clone(board.cards || []);
  state.connections = clone(board.connections || []);
  state.draft = board.draft || '';
  state.mode = board.mode || 'free';
  state.outputFormat = board.outputFormat || 'message';
  state.selectedIds = [];
  state.pendingPreview = null;
}

async function load() {
  let needsSave = false;
  try {
    const saved = await appStorage().get('sparkBoardState');
    if (saved && Array.isArray(saved.boards)) {
      state = {
        ...state,
        schemaVersion: SCHEMA_VERSION,
        boards: saved.boards,
        activeBoardId: saved.activeBoardId || saved.boards[0]?.id || 'board-default',
        selectedIds: [],
        pendingPreview: null
      };
      ensureBoards();
      applyBoard(state.boards.find((board) => board.id === state.activeBoardId) || state.boards[0]);
      if (saved.schemaVersion !== SCHEMA_VERSION) needsSave = true;
    } else if (saved && Array.isArray(saved.cards)) {
      state = {
        ...state,
        ...saved,
        schemaVersion: SCHEMA_VERSION,
        connections: Array.isArray(saved.connections) ? saved.connections : [],
        boardTitle: saved.boardTitle || t('defaultBoardTitle'),
        selectedIds: []
      };
      state.boards = [buildBoardSnapshot('board-default', state.boardTitle)];
      state.activeBoardId = state.boards[0].id;
      needsSave = true;
    }
  } catch (error) {
    runtime().log?.warn?.('Failed to load Spark Board state', { error: String(error) });
  }
  if (needsSave) save();
}

function serializeState() {
  persistCurrentBoard();
  return {
    schemaVersion: SCHEMA_VERSION,
    boards: state.boards,
    activeBoardId: state.activeBoardId,
    boardTitle: state.boardTitle,
    cards: state.cards,
    connections: state.connections,
    draft: state.draft,
    mode: state.mode,
    outputFormat: state.outputFormat
  };
}

function save() {
  appStorage().set('sparkBoardState', serializeState())
    .catch((error) => runtime().log?.warn?.('Failed to save Spark Board state', { error: String(error) }));
}

function selectedCards() {
  return state.cards.filter((card) => state.selectedIds.includes(card.id));
}

function relatedConnectionsFor(cards) {
  const selected = new Set(cards.map((card) => card.id));
  return state.connections
    .filter((connection) => selected.has(connection.from) || selected.has(connection.to))
    .map((connection) => {
      const from = state.cards.find((card) => card.id === connection.from);
      const to = state.cards.find((card) => card.id === connection.to);
      return {
        type: connection.type,
        from: from ? { id: from.id, title: from.title, kind: from.kind } : { id: connection.from },
        to: to ? { id: to.id, title: to.title, kind: to.kind } : { id: connection.to }
      };
    });
}

function updateSelectionMeta() {
  $('selectionCount').textContent = `${state.selectedIds.length} ${t('selected')}`;
  $('draftMeta').textContent = String(state.draft.trim() ? state.draft.trim().split(/\s+/).length : 0);
  $('connectionCount').textContent = String(state.connections.length);
  $('connectCards').disabled = busy || state.selectedIds.length !== 2;
}

function renderBoardSwitcher() {
  const select = $('boardSelect');
  select.innerHTML = '';
  state.boards.forEach((board) => {
    const option = document.createElement('option');
    option.value = board.id;
    option.textContent = board.title || t('untitledBoard');
    select.appendChild(option);
  });
  select.value = state.activeBoardId;
  $('boardTitle').value = state.boardTitle || '';
}

function renderLanes() {
  const canvas = $('canvas');
  canvas.querySelectorAll('.lane').forEach((node) => node.remove());
  [
    ['lane lane-input', t('laneInput')],
    ['lane lane-think', t('laneThink')],
    ['lane lane-send', t('laneSend')]
  ].forEach(([className, label]) => {
    const lane = document.createElement('div');
    lane.className = className;
    const span = document.createElement('span');
    span.textContent = label;
    lane.appendChild(span);
    canvas.appendChild(lane);
  });
}

function render() {
  const canvas = $('canvas');
  canvas.querySelectorAll('.card').forEach((node) => node.remove());
  state.cards.forEach((card) => canvas.appendChild(renderCard(card)));
  renderConnections();
  renderConnectionList();
  $('draftOutput').value = state.draft;
  renderBoardSwitcher();
  document.querySelectorAll('.mode-tab').forEach((button) => {
    button.classList.toggle('is-active', button.dataset.mode === state.mode);
  });
  $('outputFormat').value = state.outputFormat;
  renderPreview();
  updateSelectionMeta();
}

function renderPreview() {
  const panel = $('previewPanel');
  const preview = state.pendingPreview;
  panel.hidden = !preview;
  if (!preview) return;
  $('previewMeta').textContent = String((preview.cards || []).length);
  const cardsRoot = $('previewCards');
  cardsRoot.innerHTML = '';
  (preview.cards || []).forEach((card) => {
    const node = document.createElement('article');
    node.className = 'preview-card';
    node.innerHTML = '<span></span><strong></strong><p></p>';
    node.querySelector('span').textContent = kindLabel(card.kind);
    node.querySelector('strong').textContent = card.title;
    node.querySelector('p').textContent = card.body;
    cardsRoot.appendChild(node);
  });
  $('previewDraft').value = preview.draft || '';
}

function renderCard(card) {
  const node = document.createElement('article');
  node.className = `card card--${card.kind || 'idea'}${state.selectedIds.includes(card.id) ? ' is-selected' : ''}`;
  node.style.transform = `translate(${card.x}px, ${card.y}px)`;
  node.dataset.id = card.id;
  node.innerHTML = `
    <div class="card-header">
      <span class="card-kind"></span>
      <button class="card-remove" type="button" title="${t('remove')}" aria-label="${t('remove')}">x</button>
    </div>
    <textarea class="card-title" rows="1"></textarea>
    <textarea class="card-body" rows="3"></textarea>
  `;
  node.querySelector('.card-kind').textContent = kindLabel(card.kind);
  const title = node.querySelector('.card-title');
  const body = node.querySelector('.card-body');
  title.value = card.title;
  body.value = card.body;
  title.addEventListener('input', (event) => updateCard(card.id, { title: event.target.value }));
  body.addEventListener('input', (event) => updateCard(card.id, { body: event.target.value }));
  node.querySelector('.card-remove').addEventListener('click', (event) => {
    event.stopPropagation();
    state.cards = state.cards.filter((item) => item.id !== card.id);
    state.selectedIds = state.selectedIds.filter((id) => id !== card.id);
    state.connections = state.connections.filter((connection) => connection.from !== card.id && connection.to !== card.id);
    save();
    render();
  });
  node.addEventListener('pointerdown', (event) => onCardPointerDown(event, card.id));
  node.addEventListener('click', (event) => {
    if (event.target.tagName === 'TEXTAREA' || event.target.tagName === 'BUTTON') return;
    toggleSelection(card.id, event.shiftKey || event.metaKey || event.ctrlKey);
  });
  return node;
}

function kindLabel(kind) {
  if (kind === 'assumption') return t('cardAssumption');
  if (kind === 'counterpoint') return t('cardCounterpoint');
  if (kind === 'source') return t('cardSource');
  if (kind === 'question') return t('cardQuestion');
  if (kind === 'insight' || kind === 'ai') return t('cardInsight');
  if (kind === 'output') return t('cardOutput');
  return t('cardIdea');
}

function updateCard(id, patch) {
  const card = state.cards.find((item) => item.id === id);
  if (!card) return;
  Object.assign(card, patch);
  save();
}

function updateCardPosition(id, x, y) {
  const card = state.cards.find((item) => item.id === id);
  if (!card) return null;
  card.x = x;
  card.y = y;
  return card;
}

function toggleSelection(id, additive) {
  if (additive) {
    state.selectedIds = state.selectedIds.includes(id)
      ? state.selectedIds.filter((item) => item !== id)
      : [...state.selectedIds, id];
  } else {
    state.selectedIds = state.selectedIds.length === 1 && state.selectedIds[0] === id ? [] : [id];
  }
  render();
}

function onCardPointerDown(event, id) {
  if (event.target.tagName === 'TEXTAREA' || event.target.tagName === 'BUTTON') return;
  const card = state.cards.find((item) => item.id === id);
  if (!card) return;
  dragState = {
    id,
    startX: event.clientX,
    startY: event.clientY,
    originalX: card.x,
    originalY: card.y,
    moved: false
  };
  event.currentTarget.setPointerCapture(event.pointerId);
}

window.addEventListener('pointermove', (event) => {
  if (!dragState) return;
  const dx = event.clientX - dragState.startX;
  const dy = event.clientY - dragState.startY;
  if (Math.abs(dx) + Math.abs(dy) > 3) dragState.moved = true;
  const card = updateCardPosition(
    dragState.id,
    Math.max(10, dragState.originalX + dx),
    Math.max(10, dragState.originalY + dy),
  );
  const node = document.querySelector(`[data-id="${dragState.id}"]`);
  if (node && card) node.style.transform = `translate(${card.x}px, ${card.y}px)`;
  renderConnections();
});

window.addEventListener('pointerup', () => {
  if (!dragState) return;
  dragState = null;
  save();
});

function addCardFromInput() {
  const text = $('seedInput').value.trim();
  if (!text) {
    setStatus(t('emptyInput'));
    return;
  }
  state.cards.unshift({
    id: uid(),
    kind: 'idea',
    title: text.split('\n')[0].slice(0, 72),
    body: text,
    x: 68 + (state.cards.length % 3) * 46,
    y: 100 + (state.cards.length % 4) * 58
  });
  $('seedInput').value = '';
  save();
  render();
}

function relationLabel(type) {
  if (type === 'challenges') return t('relationChallenges');
  if (type === 'expands') return t('relationExpands');
  if (type === 'becomes') return t('relationBecomes');
  return t('relationSupports');
}

function cardCenter(card) {
  return {
    x: card.x + 115,
    y: card.y + 62
  };
}

function renderConnections() {
  const layer = $('connectionLayer');
  if (!layer) return;
  const canvas = $('canvas');
  layer.setAttribute('viewBox', `0 0 ${canvas.clientWidth || 1000} ${canvas.clientHeight || 620}`);
  layer.innerHTML = `
    <defs>
      <marker id="sparkArrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
        <path d="M 0 0 L 10 5 L 0 10 z"></path>
      </marker>
    </defs>
  `;
  state.connections.forEach((connection) => {
    const from = state.cards.find((card) => card.id === connection.from);
    const to = state.cards.find((card) => card.id === connection.to);
    if (!from || !to) return;
    const start = cardCenter(from);
    const end = cardCenter(to);
    const dx = Math.max(80, Math.abs(end.x - start.x) * 0.42);
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('class', `connection connection--${connection.type}`);
    path.setAttribute('d', `M ${start.x} ${start.y} C ${start.x + dx} ${start.y}, ${end.x - dx} ${end.y}, ${end.x} ${end.y}`);
    path.setAttribute('marker-end', 'url(#sparkArrow)');
    layer.appendChild(path);

    const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    label.setAttribute('class', 'connection-label');
    label.setAttribute('x', String((start.x + end.x) / 2));
    label.setAttribute('y', String((start.y + end.y) / 2 - 8));
    label.textContent = relationLabel(connection.type);
    layer.appendChild(label);
  });
}

function renderConnectionList() {
  const root = $('connectionList');
  root.innerHTML = '';
  if (state.connections.length === 0) return;
  state.connections.slice(-5).reverse().forEach((connection) => {
    const from = state.cards.find((card) => card.id === connection.from);
    const to = state.cards.find((card) => card.id === connection.to);
    if (!from || !to) return;
    const row = document.createElement('div');
    row.className = 'connection-row';
    row.innerHTML = '<span></span><button class="btn btn-secondary btn-sm" type="button"></button>';
    row.querySelector('span').textContent = `${from.title} -> ${relationLabel(connection.type)} -> ${to.title}`;
    const button = row.querySelector('button');
    button.textContent = 'x';
    button.title = t('removeConnection');
    button.setAttribute('aria-label', t('removeConnection'));
    button.addEventListener('click', () => {
      state.connections = state.connections.filter((item) => item.id !== connection.id);
      save();
      render();
      setStatus(t('connectionRemoved'));
    });
    root.appendChild(row);
  });
}

function connectSelectedCards() {
  if (state.selectedIds.length !== 2) {
    setStatus(t('needTwoCards'));
    return;
  }
  const [from, to] = state.selectedIds;
  const type = $('relationType').value;
  const existing = state.connections.find((connection) => connection.from === from && connection.to === to);
  if (existing) {
    existing.type = type;
  } else {
    state.connections.push({ id: uid('connection'), from, to, type });
  }
  save();
  render();
  setStatus(t('connected'));
}

function fallbackSpark(text) {
  const base = text || $('seedInput').value.trim() || 'New creative direction';
  return [
    { kind: 'idea', title: 'Audience angle', body: `Who needs "${base}" badly enough to change behavior?` },
    { kind: 'question', title: 'Constraint to clarify', body: 'What must stay true even if the idea becomes smaller?' },
    { kind: 'insight', title: 'Sendable shape', body: 'Frame the output as a decision, invitation, or next action.' }
  ];
}

function normalizeCards(items, fallbackText, kind = 'ai') {
  if (!Array.isArray(items) || items.length === 0) return fallbackSpark(fallbackText);
  return items.slice(0, 6).map((item, index) => ({
    kind: ['idea', 'question', 'insight', 'output', 'ai', 'assumption', 'counterpoint', 'source'].includes(item.kind) ? item.kind : kind,
    title: String(item.title || `Spark ${index + 1}`).slice(0, 90),
    body: String(item.body || item.text || '').slice(0, 700)
  }));
}

function extractJson(text) {
  const raw = String(text || '').trim();
  try {
    return JSON.parse(raw);
  } catch (_) {
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]);
    } catch (error) {
      runtime().log?.warn?.('Failed to parse AI JSON', { error: String(error) });
      return null;
    }
  }
}

async function askAi(action, cards, topic) {
  const outputFormat = state.outputFormat || 'message';
  const relatedConnections = relatedConnectionsFor(cards);
  const boardSummary = {
    title: state.boardTitle,
    cardCount: state.cards.length,
    connectionCount: state.connections.length,
    outputFormat,
    selectedCardIds: cards.map((card) => card.id)
  };
  const prompt = [
    'You are Spark Board, an AI creative canvas collaborator.',
    'Return compact JSON only with this shape: {"cards":[{"kind":"idea|question|insight|output|assumption|counterpoint|source","title":"...","body":"..."}],"draft":"optional send-ready text"}.',
    `Action: ${action}.`,
    `Requested output format: ${outputFormat}.`,
    `Topic: ${topic || 'none'}.`,
    `Board summary: ${JSON.stringify(boardSummary)}.`,
    `Selected cards: ${JSON.stringify(cards.map(({ id, title, body, kind, x, y }) => ({ id, title, body, kind, x, y })))}.`,
    `Related connections: ${JSON.stringify(relatedConnections)}.`
  ].join('\n');
  const result = await runtime().ai.complete(prompt, {
    systemPrompt: 'Create useful, specific, concise creative thinking cards. If drafting, match the requested output format. Do not include markdown fences.',
    maxTokens: 1000,
    temperature: 0.65
  });
  return extractJson(result && result.text ? result.text : result);
}

function buildGeneratedCards(cards, preferredKind) {
  const baseX = preferredKind === 'output' ? Math.max(720, $('canvas').clientWidth - 300) : 380;
  const baseY = 72 + (state.cards.length % 4) * 34;
  return cards.map((card, index) => ({
    id: uid('ai'),
    kind: card.kind || preferredKind || 'ai',
    title: card.title,
    body: card.body,
    x: baseX + (index % 2) * 260,
    y: baseY + Math.floor(index / 2) * 156
  }));
}

function setPreview(cards, draft, preferredKind) {
  state.pendingPreview = {
    cards: buildGeneratedCards(cards, preferredKind),
    draft: draft || ''
  };
  setStatus(t('previewReady'));
}

function acceptPreview() {
  const preview = state.pendingPreview;
  if (!preview) return;
  const draftText = $('previewDraft').value.trim();
  const cards = (preview.cards || []).map((card) => ({ ...card }));
  state.cards.push(...cards);
  state.selectedIds = cards.map((card) => card.id);
  if (draftText) state.draft = draftText;
  state.pendingPreview = null;
  save();
  render();
  setStatus(t('accepted'));
}

function discardPreview() {
  state.pendingPreview = null;
  render();
  setStatus(t('previewDiscarded'));
}

function placeGenerated(cards, preferredKind) {
  const next = buildGeneratedCards(cards, preferredKind);
  state.cards.push(...next);
  state.selectedIds = next.map((card) => card.id);
}

async function sparkIdeas() {
  const topic = $('seedInput').value.trim();
  if (!topic) {
    setStatus(t('emptyInput'));
    return;
  }
  setBusy(true);
  setStatus(t('thinking'));
  try {
    const json = await askAi('spark a first board from the topic', [], topic);
    setPreview(normalizeCards(json?.cards, topic), json?.draft ? String(json.draft) : '', 'idea');
    $('seedInput').value = '';
  } catch (error) {
    runtime().log?.warn?.('Spark Board AI spark failed', { error: String(error) });
    setPreview(fallbackSpark(topic), '', 'idea');
    setStatus(t('aiFailed'));
  } finally {
    setBusy(false);
    save();
    render();
  }
}

async function runAction(action) {
  const cards = selectedCards();
  if (cards.length === 0) {
    setStatus(t('needSelection'));
    return;
  }
  setBusy(true);
  setStatus(t('thinking'));
  try {
    const json = await askAi(action, cards, $('seedInput').value.trim());
    if (action === 'draft') {
      const draftText = String(json?.draft || cards.map((card) => `${card.title}\n${card.body}`).join('\n\n'));
      setPreview(normalizeCards(json?.cards, draftText, 'output').slice(0, 2), draftText, 'output');
    } else {
      setPreview(normalizeCards(json?.cards, action, 'ai'), json?.draft ? String(json.draft) : '', 'ai');
    }
  } catch (error) {
    runtime().log?.warn?.('Spark Board AI action failed', { action, error: String(error) });
    const fallback = action === 'challenge'
      ? [{ kind: 'question', title: 'What could be wrong?', body: 'Name the assumption that would break this idea if it turned out false.' }]
      : fallbackSpark(cards[0]?.title);
    setPreview(fallback, '', action === 'draft' ? 'output' : 'ai');
    setStatus(t('aiFailed'));
  } finally {
    setBusy(false);
    save();
    render();
  }
}

async function copyDraft() {
  const text = $('draftOutput').value.trim();
  if (!text) {
    setStatus(t('copyEmpty'));
    return;
  }
  state.draft = text;
  save();
  try {
    await copyText(text);
    setStatus(t('copied'));
  } catch (error) {
    runtime().log?.warn?.('Failed to copy Spark Board draft', { error: String(error) });
    setStatus(t('copied'));
  }
}

async function sendDraft() {
  const text = $('draftOutput').value.trim();
  if (!text) {
    setStatus(t('copyEmpty'));
    return;
  }
  state.draft = text;
  save();
  try {
    if (!runtime().host?.fillChatInput) throw new Error('host.fillChatInput unavailable');
    await runtime().host.fillChatInput(text);
    setStatus(t('sentToChat'));
  } catch (error) {
    runtime().log?.warn?.('Failed to send Spark Board draft to chat input', { error: String(error) });
    await copyText(text);
    setStatus(t('sendUnavailable'));
  }
}

async function copyText(text) {
  if (runtime().clipboard) {
    await runtime().clipboard.writeText(text);
    return;
  }
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  throw new Error('Clipboard is unavailable');
}

function escapeMarkdown(text) {
  return String(text || '').replace(/\r\n/g, '\n').trim();
}

function boardToMarkdown() {
  const lines = [`# ${escapeMarkdown(state.boardTitle || t('untitledBoard'))}`, ''];
  lines.push(`_Exported from Spark Board_`, '');

  if (state.cards.length > 0) {
    lines.push('## Cards', '');
    state.cards.forEach((card, index) => {
      lines.push(`### ${index + 1}. ${escapeMarkdown(card.title || kindLabel(card.kind))}`);
      lines.push('');
      lines.push(`- Type: ${kindLabel(card.kind)}`);
      lines.push(`- Position: ${Math.round(card.x)}, ${Math.round(card.y)}`);
      if (card.body) {
        lines.push('');
        lines.push(escapeMarkdown(card.body));
      }
      lines.push('');
    });
  }

  if (state.connections.length > 0) {
    lines.push('## Connections', '');
    state.connections.forEach((connection) => {
      const from = state.cards.find((card) => card.id === connection.from);
      const to = state.cards.find((card) => card.id === connection.to);
      if (!from || !to) return;
      lines.push(`- **${escapeMarkdown(from.title)}** ${relationLabel(connection.type).toLowerCase()} **${escapeMarkdown(to.title)}**`);
    });
    lines.push('');
  }

  if (state.draft.trim()) {
    lines.push('## Send-ready Draft', '');
    lines.push(escapeMarkdown(state.draft));
    lines.push('');
  }

  return lines.join('\n').replace(/\n{3,}/g, '\n\n');
}

async function exportMarkdown() {
  const markdown = boardToMarkdown();
  try {
    await copyText(markdown);
    setStatus(t('exported'));
  } catch (error) {
    runtime().log?.warn?.('Failed to export Spark Board Markdown', { error: String(error) });
    setStatus(t('exported'));
  }
}

function resetBoard() {
  state.cards = clone(DEFAULT_CARDS);
  state.selectedIds = [];
  state.connections = [];
  state.draft = '';
  state.mode = 'free';
  state.outputFormat = 'message';
  state.pendingPreview = null;
  $('seedInput').value = '';
  setStatus(t('resetDone'));
  save();
  render();
}

function createBoard() {
  persistCurrentBoard();
  const id = uid('board');
  const title = `${t('newBoardTitle')} ${state.boards.length + 1}`;
  state.boards.unshift({
    id,
    title,
    cards: [],
    connections: [],
    draft: '',
    mode: 'free',
    outputFormat: 'message',
    schemaVersion: SCHEMA_VERSION,
    updatedAt: Date.now()
  });
  applyBoard(state.boards[0]);
  $('seedInput').value = '';
  save();
  render();
  setStatus(t('boardCreated'));
}

function switchBoard(id) {
  state.boardTitle = $('boardTitle').value.trim() || state.boardTitle;
  persistCurrentBoard();
  const board = state.boards.find((item) => item.id === id);
  if (!board) return;
  applyBoard(board);
  $('seedInput').value = '';
  save();
  render();
}

function renameBoard(title) {
  state.boardTitle = title.trim() || t('untitledBoard');
  save();
  renderBoardSwitcher();
}

function initEvents() {
  $('addCard').addEventListener('click', addCardFromInput);
  $('sparkIdeas').addEventListener('click', sparkIdeas);
  $('exportMarkdown').addEventListener('click', exportMarkdown);
  $('sendDraft').addEventListener('click', sendDraft);
  $('copyDraft').addEventListener('click', copyDraft);
  $('resetBoard').addEventListener('click', resetBoard);
  $('newBoard').addEventListener('click', createBoard);
  $('boardSelect').addEventListener('change', (event) => switchBoard(event.target.value));
  $('boardTitle').addEventListener('change', (event) => {
    renameBoard(event.target.value);
    setStatus(t('boardRenamed'));
  });
  $('connectCards').addEventListener('click', connectSelectedCards);
  $('acceptPreview').addEventListener('click', acceptPreview);
  $('discardPreview').addEventListener('click', discardPreview);
  $('previewDraft').addEventListener('input', (event) => {
    if (!state.pendingPreview) return;
    state.pendingPreview.draft = event.target.value;
  });
  $('outputFormat').addEventListener('change', (event) => {
    state.outputFormat = event.target.value;
    save();
  });
  $('draftOutput').addEventListener('input', (event) => {
    state.draft = event.target.value;
    save();
    updateSelectionMeta();
  });
  document.querySelectorAll('.ai-action').forEach((button) => {
    button.addEventListener('click', () => runAction(button.dataset.action));
  });
  document.querySelectorAll('.mode-tab').forEach((button) => {
    button.addEventListener('click', () => {
      state.mode = button.dataset.mode;
      save();
      render();
    });
  });
  $('canvas').addEventListener('click', (event) => {
    if (event.target.id === 'canvas') {
      state.selectedIds = [];
      render();
    }
  });
  if (runtime().onLocaleChange) runtime().onLocaleChange(() => {
    applyI18n();
    render();
  });
  window.addEventListener('resize', renderConnections);
}

async function init() {
  await load();
  applyI18n();
  initEvents();
  render();
}

init();
