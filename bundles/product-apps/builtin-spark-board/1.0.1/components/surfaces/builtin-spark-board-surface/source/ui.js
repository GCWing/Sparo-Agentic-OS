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
  activeConnectionId: null
};

let dragState = null;
let connectDragState = null;
let relationContext = null;
let panState = null;
let suppressCanvasClick = false;
let busy = false;
let saveTimer = null;

const $ = (id) => document.getElementById(id);
const runtime = () => window.app || {};
const locale = () => runtime().locale || 'en-US';
const t = (key) => (STRINGS[locale()] || STRINGS['en-US'])[key] || STRINGS['en-US'][key] || key;
const uid = (prefix = 'card') => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const root = () => document.querySelector('.spark-board');

/* ---------- Viewport (infinite pan/zoom canvas) ---------- */

const MIN_ZOOM = 0.3;
const MAX_ZOOM = 2.4;
let view = { panX: 0, panY: 0, zoom: 1 };

function canvasRect() {
  return $('canvas').getBoundingClientRect();
}

function applyView() {
  const stage = $('canvasStage');
  if (!stage) return;
  stage.style.transformOrigin = '0 0';
  stage.style.transform = `translate(${view.panX}px, ${view.panY}px) scale(${view.zoom})`;
  updateZoomLabel();
}

function animateView(next, ms = 380) {
  const stage = $('canvasStage');
  if (!stage) { Object.assign(view, next); return; }
  stage.classList.add('is-view-animating');
  Object.assign(view, next);
  applyView();
  window.clearTimeout(animateView._timer);
  animateView._timer = window.setTimeout(() => stage.classList.remove('is-view-animating'), ms + 40);
}

function screenToWorld(clientX, clientY) {
  const rect = canvasRect();
  return {
    x: (clientX - rect.left - view.panX) / view.zoom,
    y: (clientY - rect.top - view.panY) / view.zoom
  };
}

function worldToScreen(wx, wy) {
  return { x: wx * view.zoom + view.panX, y: wy * view.zoom + view.panY };
}

function viewportCenterWorld() {
  const rect = canvasRect();
  return screenToWorld(rect.left + rect.width / 2, rect.top + rect.height / 2);
}

function zoomAt(clientX, clientY, factor) {
  const rect = canvasRect();
  const sx = clientX - rect.left;
  const sy = clientY - rect.top;
  const worldX = (sx - view.panX) / view.zoom;
  const worldY = (sy - view.panY) / view.zoom;
  const nextZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, view.zoom * factor));
  view.panX = sx - worldX * nextZoom;
  view.panY = sy - worldY * nextZoom;
  view.zoom = nextZoom;
  applyView();
  scheduleSave();
}

function updateZoomLabel() {
  const label = $('zoomLabel');
  if (label) label.textContent = `${Math.round(view.zoom * 100)}%`;
}

function fitView(cards, { animate = true, maxZoom = 1.1, padding = 80 } = {}) {
  const list = (cards && cards.length ? cards : state.cards) || [];
  const rect = canvasRect();
  const vw = rect.width || 800;
  const vh = rect.height || 600;
  if (list.length === 0) {
    const next = { panX: 0, panY: 0, zoom: 1 };
    animate ? animateView(next) : (Object.assign(view, next), applyView());
    scheduleSave();
    return;
  }
  const box = computeBoundingBox(list);
  const contentW = Math.max(box.maxX - box.minX, CARD_WIDTH);
  const contentH = Math.max(box.maxY - box.minY, CARD_HEIGHT);
  const zoom = Math.max(MIN_ZOOM, Math.min(maxZoom, Math.min(
    (vw - padding * 2) / contentW,
    (vh - padding * 2) / contentH
  )));
  const cx = (box.minX + box.maxX) / 2;
  const cy = (box.minY + box.maxY) / 2;
  const next = {
    zoom,
    panX: vw / 2 - cx * zoom,
    panY: vh / 2 - cy * zoom
  };
  animate ? animateView(next) : (Object.assign(view, next), applyView());
  scheduleSave();
}

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
  document.querySelectorAll('[data-i18n-aria]').forEach((node) => { node.setAttribute('aria-label', t(node.dataset.i18nAria)); });
  document.querySelectorAll('[data-i18n-title]').forEach((node) => { node.title = t(node.dataset.i18nTitle); });
}

function setStatus(message) {
  const line = $('statusLine');
  if (line) line.textContent = message;
}

function scheduleSave(delay = 180) {
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => save(), delay);
}

function setBusy(nextBusy) {
  busy = nextBusy;
  const sparkButton = $('sparkIdeas');
  if (sparkButton) {
    if (busy) sparkButton.dataset.busy = 'true';
    else delete sparkButton.dataset.busy;
    sparkButton.setAttribute('aria-label', busy ? t('cancelAi') : t('sparkIdeas'));
    sparkButton.title = busy ? t('cancelAi') : '';
  }
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
    view: { ...view },
    schemaVersion: SCHEMA_VERSION,
    updatedAt: Date.now()
  };
}

function normalizeView(raw) {
  if (raw && Number.isFinite(raw.zoom) && Number.isFinite(raw.panX) && Number.isFinite(raw.panY)) {
    return { panX: raw.panX, panY: raw.panY, zoom: Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, raw.zoom)) };
  }
  return null;
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
    view: normalizeView(board.view),
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
  state.activeConnectionId = null;
  const storedView = normalizeView(board.view);
  view = storedView || { panX: 0, panY: 0, zoom: 1 };
  state._needsFit = !storedView;
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
        selectedIds: []
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
  const count = state.selectedIds.length;
  $('selectionCount').textContent = count > 0 ? `${count} ${t('selected')}` : '0';
  $('selectionBarLabel').textContent = String(count);
  $('draftMeta').textContent = String(state.draft.trim() ? state.draft.trim().split(/\s+/).length : 0);
  $('connectionCount').textContent = String(state.connections.length);
  $('emptyPrompt').hidden = state.cards.length > 0;
  if ($('previewDraft')) $('previewDraft').value = state.draft;
}

function renderBoardSwitcher() {
  const select = $('boardSelect');
  select.innerHTML = '';
  const tabs = $('boardTabs');
  tabs.innerHTML = '';
  tabs.dataset.single = state.boards.length === 1 ? 'true' : 'false';
  state.boards.forEach((board) => {
    const option = document.createElement('option');
    option.value = board.id;
    option.textContent = board.title || t('untitledBoard');
    select.appendChild(option);

    const tab = document.createElement('div');
    tab.className = `board-tab${board.id === state.activeBoardId ? ' is-active' : ''}`;
    tab.dataset.boardId = board.id;
    tab.setAttribute('role', 'tab');
    tab.setAttribute('tabindex', '0');
    tab.setAttribute('aria-selected', board.id === state.activeBoardId ? 'true' : 'false');
    tab.title = board.title || t('untitledBoard');

    const label = document.createElement('span');
    label.className = 'board-tab-label';
    label.textContent = board.title || t('untitledBoard');
    tab.appendChild(label);

    const close = document.createElement('span');
    close.className = 'board-tab-close';
    close.setAttribute('role', 'button');
    close.setAttribute('aria-label', t('deleteBoard'));
    close.title = t('deleteBoard');
    close.textContent = '×';
    close.addEventListener('click', (event) => {
      event.stopPropagation();
      deleteBoard(board.id);
    });
    tab.appendChild(close);

    tab.addEventListener('click', (event) => {
      if (event.target.closest('.board-tab-close')) return;
      switchBoard(board.id);
    });
    tab.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        switchBoard(board.id);
      }
    });
    tabs.appendChild(tab);
  });
  select.value = state.activeBoardId;
  $('boardTitle').value = state.boardTitle || '';
}

function deleteBoard(id) {
  if (busy) cancelThinking();
  const index = state.boards.findIndex((board) => board.id === id);
  if (index < 0) return;
  state.boards.splice(index, 1);
  if (state.boards.length === 0) {
    const fresh = {
      id: uid('board'),
      title: t('defaultBoardTitle'),
      cards: [],
      connections: [],
      draft: '',
      mode: 'free',
      outputFormat: 'message',
      schemaVersion: SCHEMA_VERSION,
      updatedAt: Date.now()
    };
    state.boards.push(fresh);
    applyBoard(fresh);
  } else if (state.activeBoardId === id) {
    const next = state.boards[Math.min(index, state.boards.length - 1)];
    applyBoard(next);
  }
  save();
  render();
  setStatus(t('boardDeleted'));
}

function render() {
  const stage = $('canvasStage');
  stage.querySelectorAll('.card').forEach((node) => node.remove());
  state.cards.forEach((card) => stage.appendChild(renderCard(card)));
  measureCards();
  renderConnections();
  renderConnectionList();
  $('draftOutput').value = state.draft;
  renderBoardSwitcher();
  $('outputFormat').value = state.outputFormat;
  updateSelectionMeta();
  if (state._needsFit) {
    state._needsFit = false;
    fitView(state.cards, { animate: false });
  } else {
    applyView();
  }
}

function measureCards() {
  const stage = $('canvasStage');
  if (!stage) return;
  state.cards.forEach((card) => {
    const node = stage.querySelector(`.card[data-id="${card.id}"]`);
    if (node) card._h = node.offsetHeight;
  });
}

function cardHeight(card) {
  return (card && Number.isFinite(card._h) && card._h > 0) ? card._h : CARD_HEIGHT;
}

function renderCard(card) {
  const node = document.createElement('article');
  const classes = ['card', `card--${card.kind || 'idea'}`];
  if (state.selectedIds.includes(card.id)) classes.push('is-selected');
  if (card._glow && !card._renderedOnce) classes.push('is-glowing');
  node.className = classes.join(' ');
  node.style.transform = `translate(${card.x}px, ${card.y}px)`;
  node.dataset.id = card.id;
  node.innerHTML = `
    <div class="card-header">
      <span class="card-kind"></span>
      <button class="card-remove" type="button">×</button>
    </div>
    <textarea class="card-title" rows="1"></textarea>
    <textarea class="card-body" rows="3"></textarea>
    <div class="card-actions" role="toolbar" aria-label="Card actions">
      <button class="card-action card-action--expand" type="button" data-action="expand">
        <span class="card-action-glyph">✦</span><span class="card-action-label"></span>
      </button>
      <button class="card-action card-action--challenge" type="button" data-action="challenge">
        <span class="card-action-glyph">⚠</span><span class="card-action-label"></span>
      </button>
      <button class="card-action card-action--draft" type="button" data-action="draft">
        <span class="card-action-glyph"> → </span><span class="card-action-label"></span>
      </button>
    </div>
    <button class="card-handle" type="button" aria-hidden="false"></button>
  `;

  const kindNode = node.querySelector('.card-kind');
  kindNode.textContent = kindLabel(card.kind);

  const expandBtn = node.querySelector('.card-action--expand');
  const challengeBtn = node.querySelector('.card-action--challenge');
  const draftBtn = node.querySelector('.card-action--draft');
  expandBtn.querySelector('.card-action-label').textContent = t('expand');
  expandBtn.title = t('cardActionExpand');
  expandBtn.setAttribute('aria-label', t('cardActionExpand'));
  challengeBtn.querySelector('.card-action-label').textContent = t('challenge');
  challengeBtn.title = t('cardActionChallenge');
  challengeBtn.setAttribute('aria-label', t('cardActionChallenge'));
  draftBtn.querySelector('.card-action-label').textContent = t('draft');
  draftBtn.title = t('cardActionDraft');
  draftBtn.setAttribute('aria-label', t('cardActionDraft'));

  const removeBtn = node.querySelector('.card-remove');
  removeBtn.title = t('remove');
  removeBtn.setAttribute('aria-label', t('remove'));

  const handle = node.querySelector('.card-handle');
  handle.title = t('cardActionConnect');
  handle.setAttribute('aria-label', t('cardActionConnect'));

  const title = node.querySelector('.card-title');
  const body = node.querySelector('.card-body');
  title.value = card.title;
  body.value = card.body;
  title.addEventListener('input', (event) => updateCard(card.id, { title: event.target.value }));
  body.addEventListener('input', (event) => updateCard(card.id, { body: event.target.value }));

  removeBtn.addEventListener('click', (event) => {
    event.stopPropagation();
    state.cards = state.cards.filter((item) => item.id !== card.id);
    state.selectedIds = state.selectedIds.filter((id) => id !== card.id);
    state.connections = state.connections.filter((c) => c.from !== card.id && c.to !== card.id);
    save();
    render();
  });

  node.querySelectorAll('.card-action').forEach((btn) => {
    btn.addEventListener('click', (event) => {
      event.stopPropagation();
      if (!state.selectedIds.includes(card.id)) state.selectedIds = [card.id];
      const action = btn.dataset.action;
      runAction(action);
    });
    btn.addEventListener('pointerdown', (event) => event.stopPropagation());
  });

  handle.addEventListener('pointerdown', (event) => onHandlePointerDown(event, card.id));

  node.addEventListener('pointerdown', (event) => onCardPointerDown(event, card.id));
  node.addEventListener('click', (event) => {
    if (event.target.closest('textarea, button')) return;
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
  if (event.target.closest('textarea, button, .card-handle')) return;
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

function onHandlePointerDown(event, fromId) {
  event.stopPropagation();
  event.preventDefault();
  const point = screenToWorld(event.clientX, event.clientY);
  connectDragState = {
    fromId,
    currentX: point.x,
    currentY: point.y,
    targetId: null,
    pointerId: event.pointerId
  };
  event.target.setPointerCapture(event.pointerId);
  hideRelationPopover();
  hideConnectionTools();
  renderConnections();
}

window.addEventListener('pointermove', (event) => {
  if (panState) {
    view.panX = panState.panX + (event.clientX - panState.startX);
    view.panY = panState.panY + (event.clientY - panState.startY);
    if (Math.abs(event.clientX - panState.startX) + Math.abs(event.clientY - panState.startY) > 3) panState.moved = true;
    applyView();
    return;
  }
  if (connectDragState) {
    const point = screenToWorld(event.clientX, event.clientY);
    connectDragState.currentX = point.x;
    connectDragState.currentY = point.y;
    const targetEl = document.elementFromPoint(event.clientX, event.clientY);
    const targetCard = targetEl?.closest?.('.card');
    const nextTargetId = targetCard && targetCard.dataset.id !== connectDragState.fromId ? targetCard.dataset.id : null;
    if (nextTargetId !== connectDragState.targetId) {
      if (connectDragState.targetId) {
        document.querySelector(`.card[data-id="${connectDragState.targetId}"]`)?.classList.remove('is-drop-target');
      }
      if (nextTargetId) {
        document.querySelector(`.card[data-id="${nextTargetId}"]`)?.classList.add('is-drop-target');
      }
      connectDragState.targetId = nextTargetId;
    }
    renderConnections();
    return;
  }
  if (!dragState) return;
  const dx = (event.clientX - dragState.startX) / view.zoom;
  const dy = (event.clientY - dragState.startY) / view.zoom;
  if (Math.abs(dx) + Math.abs(dy) > 3) dragState.moved = true;
  const card = updateCardPosition(dragState.id, dragState.originalX + dx, dragState.originalY + dy);
  const node = document.querySelector(`[data-id="${dragState.id}"]`);
  if (node && card) node.style.transform = `translate(${card.x}px, ${card.y}px)`;
  renderConnections();
});

window.addEventListener('pointerup', (event) => {
  if (panState) {
    suppressCanvasClick = panState.moved;
    try { $('canvas').releasePointerCapture(panState.pointerId); } catch (_) { /* noop */ }
    $('canvas').classList.remove('is-panning');
    panState = null;
    if (suppressCanvasClick) save();
    return;
  }
  if (connectDragState) {
    const { fromId, targetId, currentX, currentY } = connectDragState;
    if (targetId) {
      document.querySelector(`.card[data-id="${targetId}"]`)?.classList.remove('is-drop-target');
    }
    if (targetId && targetId !== fromId) {
      showRelationPopover(currentX, currentY, fromId, targetId);
    }
    connectDragState = null;
    renderConnections();
    return;
  }
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
  const center = viewportCenterWorld();
  const card = {
    id: uid(),
    kind: 'idea',
    title: text.split('\n')[0].slice(0, 72),
    body: text,
    x: Math.round(center.x - CARD_WIDTH / 2),
    y: Math.round(center.y - CARD_HEIGHT / 2),
    _glow: true
  };
  state.cards.unshift(card);
  $('seedInput').value = '';
  save();
  render();
  card._renderedOnce = true;
  setTimeout(() => { delete card._glow; render(); }, 850);
  fitView([card, ...selectedCards()], { maxZoom: 1.1 });
}

function inferOutputFormat(instruction) {
  const text = String(instruction || '').toLowerCase();
  if (/\b(email|mail)\b/.test(text) || /邮件|邮箱/.test(text)) return 'email';
  if (/\b(issue|ticket|bug)\b/.test(text) || /工单|问题单/.test(text)) return 'issue';
  if (/\bprd|product requirement|requirements?\b/.test(text) || /需求|产品文档/.test(text)) return 'prd';
  if (/\bpost|tweet|thread|social\b/.test(text) || /帖子|推文|社媒/.test(text)) return 'post';
  if (/\bmarkdown|md\b/.test(text)) return 'markdown';
  return state.outputFormat || 'message';
}

function relationLabel(type) {
  if (type === 'challenges') return t('relationChallenges');
  if (type === 'expands') return t('relationExpands');
  if (type === 'becomes') return t('relationBecomes');
  return t('relationSupports');
}

function cardBox(card) {
  const w = CARD_WIDTH;
  const h = cardHeight(card);
  return { x: card.x, y: card.y, w, h, cx: card.x + w / 2, cy: card.y + h / 2 };
}

function cardHandleAnchor(card) {
  const box = cardBox(card);
  return { x: box.x + box.w, y: box.cy };
}

// Pick the nearest pair of edges based on the relative position of two cards.
function edgeAnchors(from, to) {
  const a = cardBox(from);
  const b = cardBox(to);
  const horizontal = Math.abs(b.cx - a.cx) >= Math.abs(b.cy - a.cy);
  if (horizontal) {
    return b.cx >= a.cx
      ? { start: { x: a.x + a.w, y: a.cy }, end: { x: b.x, y: b.cy }, dir: 'h' }
      : { start: { x: a.x, y: a.cy }, end: { x: b.x + b.w, y: b.cy }, dir: 'h' };
  }
  return b.cy >= a.cy
    ? { start: { x: a.cx, y: a.y + a.h }, end: { x: b.cx, y: b.y }, dir: 'v' }
    : { start: { x: a.cx, y: a.y }, end: { x: b.cx, y: b.y + b.h }, dir: 'v' };
}

function bezierPath(start, end, dir) {
  if (dir === 'v') {
    const dy = Math.max(40, Math.abs(end.y - start.y) * 0.45);
    return `M ${start.x} ${start.y} C ${start.x} ${start.y + dy}, ${end.x} ${end.y - dy}, ${end.x} ${end.y}`;
  }
  const dx = Math.max(48, Math.abs(end.x - start.x) * 0.42);
  const sign = end.x >= start.x ? 1 : -1;
  return `M ${start.x} ${start.y} C ${start.x + dx * sign} ${start.y}, ${end.x - dx * sign} ${end.y}, ${end.x} ${end.y}`;
}

function renderConnections() {
  const layer = $('connectionLayer');
  if (!layer) return;
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
    const { start, end, dir } = edgeAnchors(from, to);
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    const isActive = state.activeConnectionId === connection.id;
    path.setAttribute('class', `connection connection--${connection.type}${isActive ? ' is-active' : ''}`);
    path.setAttribute('d', bezierPath(start, end, dir));
    path.setAttribute('marker-end', 'url(#sparkArrow)');
    path.dataset.connectionId = connection.id;
    const mid = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
    path.addEventListener('click', (event) => {
      event.stopPropagation();
      showConnectionTools(connection.id, mid.x, mid.y - 14);
    });
    layer.appendChild(path);

    const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    label.setAttribute('class', 'connection-label');
    label.setAttribute('x', String(mid.x));
    label.setAttribute('y', String(mid.y - 8));
    label.textContent = relationLabel(connection.type);
    layer.appendChild(label);
  });

  if (connectDragState) {
    const from = state.cards.find((card) => card.id === connectDragState.fromId);
    if (from) {
      const start = cardHandleAnchor(from);
      const end = { x: connectDragState.currentX, y: connectDragState.currentY };
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('class', 'connection-temp');
      path.setAttribute('d', bezierPath(start, end, 'h'));
      layer.appendChild(path);
    }
  }
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
    row.innerHTML = '<span></span><button class="btn-mini" type="button"></button>';
    row.querySelector('span').textContent = `${from.title} -> ${relationLabel(connection.type)} -> ${to.title}`;
    const button = row.querySelector('button');
    button.textContent = '×';
    button.title = t('removeConnection');
    button.setAttribute('aria-label', t('removeConnection'));
    button.addEventListener('click', () => removeConnection(connection.id));
    root.appendChild(row);
  });
}

function removeConnection(id) {
  state.connections = state.connections.filter((item) => item.id !== id);
  state.activeConnectionId = null;
  hideConnectionTools();
  save();
  render();
  setStatus(t('connectionRemoved'));
}

function showRelationPopover(worldX, worldY, fromId, toId) {
  relationContext = { fromId, toId };
  const popover = $('relationPopover');
  const canvas = $('canvas');
  const screen = worldToScreen(worldX, worldY);
  const width = 220;
  const left = Math.max(8, Math.min(canvas.clientWidth - width - 8, screen.x - width / 2));
  const top = Math.max(8, Math.min(canvas.clientHeight - 180, screen.y + 14));
  popover.style.left = `${left}px`;
  popover.style.top = `${top}px`;
  popover.hidden = false;
}

function hideRelationPopover() {
  const popover = $('relationPopover');
  if (popover) popover.hidden = true;
  relationContext = null;
}

function showConnectionTools(connectionId, x, y) {
  state.activeConnectionId = connectionId;
  const tools = $('connectionTools');
  if (!tools) return;
  const connection = state.connections.find((c) => c.id === connectionId);
  if (!connection) return;
  $('connectionToolsLabel').textContent = relationLabel(connection.type);
  const canvas = $('canvas');
  const screen = worldToScreen(x, y);
  const left = Math.max(40, Math.min(canvas.clientWidth - 40, screen.x));
  const top = Math.max(20, Math.min(canvas.clientHeight - 20, screen.y));
  tools.style.left = `${left}px`;
  tools.style.top = `${top}px`;
  tools.hidden = false;
  renderConnections();
}

function hideConnectionTools() {
  const tools = $('connectionTools');
  if (tools) tools.hidden = true;
  if (state.activeConnectionId !== null) {
    state.activeConnectionId = null;
    renderConnections();
  }
}

function connectSelectedCards() {
  if (state.selectedIds.length !== 2) {
    setStatus(t('needTwoCards'));
    return;
  }
  const [from, to] = state.selectedIds;
  const type = $('relationType').value;
  const existing = state.connections.find((connection) => connection.from === from && connection.to === to);
  if (existing) existing.type = type;
  else state.connections.push({ id: uid('connection'), from, to, type });
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

function buildPrompt(action, cards, topic, outputFormat) {
  const relatedConnections = relatedConnectionsFor(cards);
  const boardSummary = {
    title: state.boardTitle,
    cardCount: state.cards.length,
    connectionCount: state.connections.length,
    outputFormat,
    selectedCardIds: cards.map((card) => card.id)
  };
  return [
    'You are Spark Board, an AI creative canvas collaborator.',
    'Return compact JSON only with this shape: {"cards":[{"kind":"idea|question|insight|output|assumption|counterpoint|source","title":"...","body":"..."}],"draft":"optional send-ready text"}.',
    'The user experiences this as an AI-native canvas, so prefer specific cards and inferred relationships over UI instructions.',
    `Action: ${action}.`,
    `Requested output format: ${outputFormat}.`,
    `Topic: ${topic || 'none'}.`,
    `Board summary: ${JSON.stringify(boardSummary)}.`,
    `Selected cards: ${JSON.stringify(cards.map(({ id, title, body, kind, x, y }) => ({ id, title, body, kind, x, y })))}.`,
    `Related connections: ${JSON.stringify(relatedConnections)}.`
  ].join('\n');
}

function askAi(action, cards, topic) {
  const outputFormat = inferOutputFormat(`${action}\n${topic || ''}`);
  state.outputFormat = outputFormat;
  const prompt = buildPrompt(action, cards, topic, outputFormat);
  const SYSTEM = 'Create useful, specific, concise creative thinking cards. If drafting, match the requested output format. Do not include markdown fences.';

  return new Promise((resolve, reject) => {
    if (!runtime().ai || typeof runtime().ai.chat !== 'function') {
      if (typeof runtime().ai?.complete === 'function') {
        let cancelled = false;
        state.activeStream = { cancel: () => { cancelled = true; reject(new Error('cancelled')); } };
        runtime().ai.complete(prompt, { systemPrompt: SYSTEM, maxTokens: 1200, temperature: 0.65 })
          .then((result) => { if (!cancelled) { state.activeStream = null; resolve(extractJson(result?.text ?? result)); } })
          .catch((err) => { if (!cancelled) { state.activeStream = null; reject(err); } });
        return;
      }
      reject(new Error('AI bridge unavailable'));
      return;
    }

    let accumulated = '';
    let handle = null;
    let settled = false;
    let cancelled = false;
    const finish = (cb) => { if (settled) return; settled = true; state.activeStream = null; cb(); };

    const exposedCancel = () => {
      if (settled) return;
      cancelled = true;
      try { handle?.cancel?.(); } catch (_) { /* noop */ }
      finish(() => reject(new Error('cancelled')));
    };
    state.activeStream = { cancel: exposedCancel };

    runtime().ai.chat(
      [{ role: 'user', content: prompt }],
      {
        systemPrompt: SYSTEM,
        model: 'primary',
        maxTokens: 1200,
        temperature: 0.65,
        onChunk: ({ text }) => {
          if (cancelled || !text) return;
          accumulated += text;
          updateStream(accumulated);
        },
        onDone: ({ fullText }) => {
          if (cancelled) return;
          finish(() => resolve(extractJson(fullText || accumulated)));
        },
        onError: ({ message }) => {
          if (cancelled) return;
          finish(() => reject(new Error(message || 'AI failed')));
        }
      }
    ).then((h) => {
      handle = h;
      if (cancelled && h?.cancel) { try { h.cancel(); } catch (_) { /* noop */ } }
    }).catch((error) => {
      if (cancelled) return;
      finish(() => reject(error));
    });
  });
}

// --- Streaming generation: parse cards out of JSON as it arrives, drop each on canvas with glow ---

function parseStreamingCards(text) {
  const cardsKey = text.indexOf('"cards"');
  if (cardsKey < 0) return { cards: [], complete: false };
  const arrayStart = text.indexOf('[', cardsKey);
  if (arrayStart < 0) return { cards: [], complete: false };
  const cards = [];
  let depth = 0;
  let inString = false;
  let escape = false;
  let objStart = -1;
  let complete = false;
  for (let i = arrayStart + 1; i < text.length; i++) {
    const c = text[i];
    if (escape) { escape = false; continue; }
    if (inString) {
      if (c === '\\') { escape = true; continue; }
      if (c === '"') { inString = false; }
      continue;
    }
    if (c === '"') { inString = true; continue; }
    if (c === '{') {
      if (depth === 0) objStart = i;
      depth++;
    } else if (c === '}') {
      depth--;
      if (depth === 0 && objStart >= 0) {
        try {
          cards.push(JSON.parse(text.slice(objStart, i + 1)));
        } catch (_) { /* partial — skip */ }
        objStart = -1;
      }
    } else if (c === ']' && depth === 0) {
      complete = true;
      break;
    }
  }
  return { cards, complete };
}

const VALID_KINDS = ['idea', 'question', 'insight', 'output', 'ai', 'assumption', 'counterpoint', 'source'];

function normalizeStreamCard(raw, fallbackKind, index) {
  return {
    kind: VALID_KINDS.includes(raw?.kind) ? raw.kind : (fallbackKind || 'ai'),
    title: String(raw?.title || `Spark ${index + 1}`).slice(0, 90),
    body: String(raw?.body || raw?.text || '').slice(0, 700)
  };
}

// Pan (keeping current zoom) so a world point sits at a chosen screen fraction.
function focusWorldPoint(wx, wy, fracX = 0.32, fracY = 0.28, animate = true) {
  const rect = canvasRect();
  const next = {
    panX: rect.width * fracX - wx * view.zoom,
    panY: rect.height * fracY - wy * view.zoom,
    zoom: view.zoom
  };
  animate ? animateView(next) : (Object.assign(view, next), applyView());
}

function startStream(kind) {
  setBusy(true);
  setStatus(t('thinkingHint'));
  state.selectedIds = [];
  const anchor = computeAnchorPoint();
  state.stream = {
    kind: kind || 'ai',
    anchor,
    cursor: makeClusterCursor(anchor),
    placedCount: 0,
    streamedIds: [],
    prevView: { ...view }
  };
  render();
  focusWorldPoint(anchor.x, anchor.y);
  renderStreamChip();
}

// Compact, source-anchored "generating" chip — no raw JSON, single busy signal.
function renderStreamChip() {
  const stage = $('canvasStage');
  if (!stage || !state.stream) return;
  let chip = $('streamChip');
  if (!chip) {
    chip = document.createElement('div');
    chip.id = 'streamChip';
    chip.className = 'stream-chip';
    chip.innerHTML = `
      <span class="thinking-dot"></span>
      <span class="stream-chip-label"></span>
      <span class="stream-chip-count"></span>
    `;
    stage.appendChild(chip);
  }
  chip.querySelector('.stream-chip-label').textContent = t('thinkingHint');
  const count = state.stream.placedCount;
  const countNode = chip.querySelector('.stream-chip-count');
  countNode.textContent = count > 0 ? String(count) : '';
  countNode.hidden = count === 0;
  const left = state.stream.anchor.x;
  const top = state.stream.anchor.y - 34;
  chip.style.transform = `translate(${left}px, ${top}px)`;
}

function updateStream(accumulated) {
  if (!state.stream) return;
  const parsed = parseStreamingCards(accumulated);
  if (parsed.cards.length > state.stream.placedCount) {
    placeStreamCards(parsed.cards.slice(state.stream.placedCount));
  }
}

function placeStreamCards(rawCards) {
  if (!state.stream) return;
  const stage = $('canvasStage');
  const startIdx = state.stream.placedCount;

  rawCards.forEach((raw, i) => {
    const normalized = normalizeStreamCard(raw, state.stream.kind, startIdx + i);
    const slot = nextClusterSlot(state.stream.cursor, normalized);
    const card = {
      id: uid('ai'),
      kind: normalized.kind,
      title: normalized.title,
      body: normalized.body,
      x: slot.x,
      y: slot.y,
      _glow: true,
      _streaming: true
    };
    state.cards.push(card);
    state.stream.streamedIds.push(card.id);
    state.stream.placedCount += 1;
    state.selectedIds = [...state.stream.streamedIds];

    if (stage) stage.appendChild(renderCard(card));
    card._renderedOnce = true;
    setTimeout(() => { delete card._glow; }, 850);
  });

  measureCards();
  renderConnections();
  renderStreamChip();
  updateSelectionMeta();
}

function finalizeStream(json, preferredKind) {
  if (!state.stream) return;
  const parsedFinal = Array.isArray(json?.cards)
    ? json.cards.slice(0, 6).map((item, i) => normalizeStreamCard(item, preferredKind, i))
    : [];

  // Each streamed card already carries its final content (objects emit complete),
  // so we only place the tail the streaming parser hadn't reached.
  const extras = parsedFinal.slice(state.stream.placedCount);
  if (extras.length > 0) placeStreamCards(extras);

  const draft = json?.draft ? String(json.draft) : '';
  if (draft) {
    state.draft = draft;
    if (preferredKind === 'output') {
      const slot = nextClusterSlot(state.stream.cursor, { body: draft });
      const outputCard = {
        id: uid('output'),
        kind: 'output',
        title: t('outputCardTitle'),
        body: draft,
        x: slot.x,
        y: slot.y,
        _glow: true,
        _streaming: true
      };
      state.cards.push(outputCard);
      state.stream.streamedIds.push(outputCard.id);
      state.selectedIds = [...state.stream.streamedIds];
      const stage = $('canvasStage');
      if (stage) stage.appendChild(renderCard(outputCard));
      outputCard._renderedOnce = true;
      openDrawer('draft');
      setTimeout(() => { delete outputCard._glow; }, 850);
    }
  }

  state.stream.streamedIds.forEach((id) => {
    const card = state.cards.find((c) => c.id === id);
    if (card) delete card._streaming;
  });

  const framed = state.stream.streamedIds
    .map((id) => state.cards.find((c) => c.id === id))
    .filter(Boolean);
  measureCards();
  setStatus(draft ? t('drafted') : t('generated'));
  stopStream();
  if (framed.length > 0) fitView(framed, { maxZoom: 1.05 });
}

function clearStreamingCards() {
  if (!state.stream) return;
  const ids = new Set(state.stream.streamedIds);
  if (ids.size === 0) return;
  state.cards = state.cards.filter((c) => !ids.has(c.id));
  state.selectedIds = state.selectedIds.filter((id) => !ids.has(id));
  state.connections = state.connections.filter((c) => !ids.has(c.from) && !ids.has(c.to));
  ids.forEach((id) => {
    const node = document.querySelector(`.card[data-id="${id}"]`);
    if (node) node.remove();
  });
  state.stream.streamedIds = [];
  state.stream.placedCount = 0;
}

function placeFallback(rawCards, draft, preferredKind) {
  const normalized = rawCards.map((item, i) => normalizeStreamCard(item, preferredKind, i));
  const placed = buildGeneratedCards(normalized, preferredKind);
  placed.forEach((c) => { c._glow = true; });
  state.cards.push(...placed);
  state.selectedIds = placed.map((c) => c.id);
  if (draft) state.draft = draft;
  render();
  placed.forEach((c) => { c._renderedOnce = true; });
  setTimeout(() => { placed.forEach((c) => { delete c._glow; }); }, 850);
  if (placed.length > 0) fitView(placed, { maxZoom: 1.05 });
}

function stopStream() {
  setBusy(false);
  state.stream = null;
  const chip = $('streamChip');
  if (chip) chip.remove();
}

function cancelThinking() {
  const handle = state.activeStream;
  const prevView = state.stream?.prevView;
  state.activeStream = null;
  try { handle?.cancel?.(); } catch (_) { /* noop */ }
  clearStreamingCards();
  stopStream();
  if (prevView) animateView(prevView);
  setStatus(t('cancelled'));
}

function isCancelError(error) {
  const msg = String(error?.message || error || '').toLowerCase();
  return msg.includes('cancel') || msg.includes('abort');
}

const CARD_WIDTH = 232;
const CARD_HEIGHT = 116;
const CARD_GAP_X = 36;
const CARD_GAP_Y = 22;
const CLUSTER_PER_COL = 4;

function computeBoundingBox(cards) {
  const list = (cards || []).filter(Boolean);
  if (list.length === 0) return { minX: 0, minY: 0, maxX: CARD_WIDTH, maxY: CARD_HEIGHT };
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  list.forEach((c) => {
    const h = cardHeight(c);
    if (c.x < minX) minX = c.x;
    if (c.y < minY) minY = c.y;
    if (c.x + CARD_WIDTH > maxX) maxX = c.x + CARD_WIDTH;
    if (c.y + h > maxY) maxY = c.y + h;
  });
  return { minX, minY, maxX, maxY };
}

// Estimate a card's height before it is rendered, so streamed slots don't shift.
function estimateCardHeight(item) {
  const bodyLen = (item?.body || '').length;
  const titleLen = (item?.title || '').length;
  const lines = Math.ceil(bodyLen / 30) + (titleLen > 34 ? 1 : 0);
  return Math.max(110, Math.min(300, 74 + lines * 18));
}

// World-space anchor for a fresh generated cluster.
function computeAnchorPoint() {
  const selected = selectedCards();
  if (selected.length > 0) {
    const rightmost = selected.reduce((m, c) => (c.x > m.x ? c : m), selected[0]);
    return { x: rightmost.x + CARD_WIDTH + CARD_GAP_X * 2, y: rightmost.y };
  }
  if (state.cards.length === 0) {
    const center = viewportCenterWorld();
    return { x: Math.round(center.x - CARD_WIDTH / 2), y: Math.round(center.y - CARD_HEIGHT) };
  }
  const box = computeBoundingBox(state.cards);
  return { x: box.maxX + CARD_GAP_X * 2, y: box.minY };
}

// Sequential column-packing cursor: deterministic, height-aware, never overlaps.
function makeClusterCursor(anchor) {
  return { colX: anchor.x, colTop: anchor.y, y: anchor.y, countInCol: 0 };
}

function nextClusterSlot(cursor, item) {
  if (cursor.countInCol >= CLUSTER_PER_COL) {
    cursor.colX += CARD_WIDTH + CARD_GAP_X;
    cursor.y = cursor.colTop;
    cursor.countInCol = 0;
  }
  const slot = { x: cursor.colX, y: cursor.y };
  cursor.y += estimateCardHeight(item) + CARD_GAP_Y;
  cursor.countInCol += 1;
  return slot;
}

function buildGeneratedCards(cards, preferredKind) {
  const cursor = makeClusterCursor(computeAnchorPoint());
  return cards.map((card) => {
    const slot = nextClusterSlot(cursor, card);
    return {
      id: uid('ai'),
      kind: card.kind || preferredKind || 'ai',
      title: card.title,
      body: card.body,
      x: slot.x,
      y: slot.y
    };
  });
}

/* ---------- Tidy: semantic layered auto-layout ---------- */

const TIDY_FORWARD = new Set(['expands', 'becomes', 'supports']);

function computeTidyTargets() {
  const byId = new Map(state.cards.map((c) => [c.id, c]));
  const edges = state.connections.filter(
    (conn) => TIDY_FORWARD.has(conn.type) && byId.has(conn.from) && byId.has(conn.to)
  );

  const layer = new Map(state.cards.map((c) => [c.id, 0]));
  const connected = new Set();
  edges.forEach((conn) => { connected.add(conn.from); connected.add(conn.to); });

  // Longest-path layering via relaxation (cycle-safe with an iteration guard).
  let changed = true;
  let guard = 0;
  while (changed && guard++ < state.cards.length + 4) {
    changed = false;
    edges.forEach((conn) => {
      const next = layer.get(conn.from) + 1;
      if (next > layer.get(conn.to)) { layer.set(conn.to, next); changed = true; }
    });
  }

  const layers = [];
  state.cards.forEach((c) => {
    if (!connected.has(c.id)) return;
    const li = layer.get(c.id);
    (layers[li] ||= []).push(c);
  });

  const colGap = CARD_WIDTH + CARD_GAP_X * 2;
  const rowGap = CARD_GAP_Y + 8;
  const colHeights = layers.map((cards) =>
    (cards || []).reduce((sum, c) => sum + cardHeight(c) + rowGap, -rowGap)
  );
  const tallest = Math.max(0, ...colHeights);

  const targets = new Map();
  let graphBottom = 0;
  layers.forEach((cards, li) => {
    if (!cards) return;
    const x = li * colGap;
    let y = (tallest - colHeights[li]) / 2;
    cards.forEach((c) => {
      targets.set(c.id, { x, y });
      y += cardHeight(c) + rowGap;
      graphBottom = Math.max(graphBottom, y);
    });
  });

  // Cards with no semantic edges: pack into a grid block below the graph.
  const isolated = state.cards.filter((c) => !connected.has(c.id));
  if (isolated.length > 0) {
    const cols = Math.max(1, Math.min(4, Math.round(Math.sqrt(isolated.length))));
    const anchorY = targets.size > 0 ? graphBottom + CARD_GAP_Y * 3 : 0;
    const cursor = makeClusterCursor({ x: 0, y: anchorY });
    cursor.colTop = anchorY;
    // grid: fill row by row using a fixed perCol derived from cols
    let i = 0;
    const colTops = new Array(cols).fill(anchorY);
    isolated.forEach((c) => {
      const col = i % cols;
      const x = col * (CARD_WIDTH + CARD_GAP_X);
      const y = colTops[col];
      targets.set(c.id, { x, y });
      colTops[col] += cardHeight(c) + rowGap;
      i += 1;
    });
  }

  return targets;
}

function tidyBoard() {
  if (busy) return;
  if (state.cards.length === 0) { setStatus(t('ready')); return; }
  const targets = computeTidyTargets();
  const stage = $('canvasStage');
  state.cards.forEach((c) => {
    const tgt = targets.get(c.id);
    if (!tgt) return;
    c.x = tgt.x;
    c.y = tgt.y;
    const node = stage?.querySelector(`.card[data-id="${c.id}"]`);
    if (node) {
      node.classList.add('is-tidying');
      node.style.transform = `translate(${c.x}px, ${c.y}px)`;
    }
  });
  renderConnections();
  save();
  setStatus(t('tidied'));
  window.setTimeout(() => {
    stage?.querySelectorAll('.card.is-tidying').forEach((n) => n.classList.remove('is-tidying'));
    renderConnections();
    fitView(state.cards);
  }, 60);
}

async function runComposerIntent() {
  const instruction = $('seedInput').value.trim();
  if (!instruction) {
    setStatus(t('emptyInput'));
    return;
  }
  const cards = selectedCards();
  const wantsDraft = /draft|write|send|message|email|issue|prd|post|成稿|草稿|发送|邮件|需求|帖子/.test(instruction.toLowerCase());
  const preferredKind = wantsDraft ? 'output' : 'idea';
  startStream(preferredKind);
  try {
    const action = cards.length > 0
      ? `follow the user's instruction for the selected canvas cards: ${instruction}`
      : `start or reshape the canvas from this user intent: ${instruction}`;
    const json = await askAi(action, cards, instruction);
    finalizeStream(json, preferredKind);
    $('seedInput').value = '';
  } catch (error) {
    if (isCancelError(error)) {
      clearStreamingCards();
      stopStream();
      save();
      return;
    }
    clearStreamingCards();
    stopStream();
    runtime().log?.warn?.('Spark Board composer intent failed', { error: String(error) });
    placeFallback(fallbackSpark(instruction), '', preferredKind);
    setStatus(t('aiFailed'));
  } finally {
    save();
  }
}

async function runAction(action) {
  const cards = selectedCards();
  if (cards.length === 0) {
    setStatus(t('needSelection'));
    return;
  }
  const kind = action === 'draft' ? 'output' : 'ai';
  startStream(kind);
  try {
    const json = await askAi(action, cards, $('seedInput').value.trim());
    if (action === 'draft' && !json?.draft) {
      const fallbackDraft = cards.map((c) => `${c.title}\n${c.body}`).join('\n\n');
      json.draft = fallbackDraft;
    }
    finalizeStream(json, kind);
  } catch (error) {
    if (isCancelError(error)) {
      clearStreamingCards();
      stopStream();
      save();
      return;
    }
    clearStreamingCards();
    stopStream();
    runtime().log?.warn?.('Spark Board AI action failed', { action, error: String(error) });
    const fallback = action === 'challenge'
      ? [{ kind: 'counterpoint', title: 'What could be wrong?', body: 'Name the assumption that would break this idea if it turned out false.' }]
      : fallbackSpark(cards[0]?.title);
    placeFallback(fallback, '', kind);
    setStatus(t('aiFailed'));
  } finally {
    save();
  }
}

async function copyDraft() {
  const text = currentDraftText();
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
  const text = currentDraftText();
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

function currentDraftText() {
  const explicit = ($('previewDraft')?.value || $('draftOutput')?.value || state.draft || '').trim();
  if (explicit) return explicit;
  const latestOutput = [...state.cards].reverse().find((card) => card.kind === 'output' && card.body);
  return latestOutput ? latestOutput.body.trim() : '';
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
  state.activeConnectionId = null;
  view = { panX: 0, panY: 0, zoom: 1 };
  state._needsFit = true;
  $('seedInput').value = '';
  if ($('previewDraft')) $('previewDraft').value = '';
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

function openDrawer(pane) {
  root().setAttribute('data-drawer', 'open');
  const drawer = $('drawer');
  drawer.hidden = false;
  $('toggleDrawer').classList.add('is-active');
  if (pane) switchDrawerPane(pane);
}

function closeDrawer() {
  root().setAttribute('data-drawer', 'closed');
  $('toggleDrawer').classList.remove('is-active');
}

function toggleDrawer() {
  if (root().getAttribute('data-drawer') === 'open') closeDrawer();
  else openDrawer();
}

function switchDrawerPane(pane) {
  document.querySelectorAll('.drawer-tab').forEach((btn) => {
    const isActive = btn.dataset.pane === pane;
    btn.classList.toggle('is-active', isActive);
    btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
  });
  document.querySelectorAll('.drawer-pane').forEach((sec) => {
    const isActive = sec.dataset.pane === pane;
    sec.classList.toggle('is-active', isActive);
    sec.hidden = !isActive;
  });
}

function canScrollInDirection(node, deltaY) {
  if (!node) return false;
  if (node.classList?.contains('board-tabs')) return false;
  const style = window.getComputedStyle(node);
  const allowsScroll = /(auto|scroll)/.test(style.overflowY);
  if (!allowsScroll && !['TEXTAREA', 'SELECT'].includes(node.tagName)) return false;
  if (node.scrollHeight <= node.clientHeight + 1) return false;
  if (deltaY < 0) return node.scrollTop > 0;
  if (deltaY > 0) return node.scrollTop + node.clientHeight < node.scrollHeight - 1;
  return false;
}

function shouldAllowWheel(event) {
  const target = event.target;
  const boardTabs = target?.closest?.('.board-tabs');
  if (boardTabs && Math.abs(event.deltaX) > Math.abs(event.deltaY)) return true;
  const scrollRoot = target?.closest?.('textarea, .drawer-pane, .drawer-body');
  return canScrollInDirection(scrollRoot, event.deltaY);
}

function lockViewportScroll() {
  if (window.scrollX !== 0 || window.scrollY !== 0) window.scrollTo(0, 0);
  document.documentElement.scrollTop = 0;
  document.body.scrollTop = 0;
}

function initEvents() {
  $('addCard').addEventListener('click', addCardFromInput);
  $('composerForm').addEventListener('submit', (event) => {
    event.preventDefault();
    if (busy) { cancelThinking(); return; }
    runComposerIntent();
  });
  $('seedInput').addEventListener('keydown', (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault();
      if (busy) { cancelThinking(); return; }
      runComposerIntent();
    }
  });
  $('seedInput').addEventListener('input', (event) => {
    const el = event.target;
    el.style.height = 'auto';
    el.style.height = `${Math.min(140, el.scrollHeight)}px`;
  });
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
  $('previewDraft').addEventListener('input', (event) => {
    state.draft = event.target.value;
    save();
    updateSelectionMeta();
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

  $('toggleDrawer').addEventListener('click', toggleDrawer);
  $('closeDrawer').addEventListener('click', closeDrawer);
  document.querySelectorAll('.drawer-tab').forEach((tab) => {
    tab.addEventListener('click', () => switchDrawerPane(tab.dataset.pane));
  });

  document.querySelectorAll('#relationPopover button[data-relation]').forEach((btn) => {
    btn.addEventListener('click', (event) => {
      event.stopPropagation();
      const type = btn.dataset.relation;
      if (type === 'cancel' || !relationContext) {
        hideRelationPopover();
        return;
      }
      const { fromId, toId } = relationContext;
      const existing = state.connections.find((c) => c.from === fromId && c.to === toId);
      if (existing) existing.type = type;
      else state.connections.push({ id: uid('connection'), from: fromId, to: toId, type });
      hideRelationPopover();
      save();
      render();
      setStatus(t('connected'));
    });
  });

  $('deleteConnection').addEventListener('click', () => {
    if (state.activeConnectionId) removeConnection(state.activeConnectionId);
  });

  $('canvas').addEventListener('pointerdown', (event) => {
    if (event.button !== 0 && event.button !== 1) return;
    if (event.target.closest('.card, .connection, .relation-popover, .connection-tools, .canvas-floating, .canvas-controls')) return;
    panState = {
      startX: event.clientX,
      startY: event.clientY,
      panX: view.panX,
      panY: view.panY,
      moved: false,
      pointerId: event.pointerId
    };
    try { $('canvas').setPointerCapture(event.pointerId); } catch (_) { /* noop */ }
    $('canvas').classList.add('is-panning');
  });

  $('canvas').addEventListener('click', (event) => {
    if (suppressCanvasClick) { suppressCanvasClick = false; return; }
    if (event.target.closest('.card, .connection, .relation-popover, .connection-tools')) return;
    state.selectedIds = [];
    hideRelationPopover();
    hideConnectionTools();
    render();
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      hideRelationPopover();
      hideConnectionTools();
      if (busy) cancelThinking();
    }
  });

  if (runtime().onLocaleChange) runtime().onLocaleChange(() => {
    applyI18n();
    render();
  });
  window.addEventListener('resize', () => {
    lockViewportScroll();
    renderConnections();
  });
  window.addEventListener('wheel', (event) => {
    if (shouldAllowWheel(event)) return;
    event.preventDefault();
    if (event.target?.closest?.('.canvas')) {
      if (event.ctrlKey || event.metaKey) {
        zoomAt(event.clientX, event.clientY, Math.exp(-event.deltaY * 0.0015));
      } else {
        view.panX -= event.deltaX;
        view.panY -= event.deltaY;
        applyView();
        scheduleSave();
      }
    }
    lockViewportScroll();
  }, { capture: true, passive: false });

  $('zoomIn').addEventListener('click', () => {
    const rect = canvasRect();
    zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, 1.2);
  });
  $('zoomOut').addEventListener('click', () => {
    const rect = canvasRect();
    zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, 1 / 1.2);
  });
  $('zoomFit').addEventListener('click', () => fitView(state.cards));
  $('tidyBoard').addEventListener('click', tidyBoard);
  window.addEventListener('scroll', lockViewportScroll, { capture: true, passive: true });
}

async function init() {
  await load();
  applyI18n();
  initEvents();
  render();
}

init();
