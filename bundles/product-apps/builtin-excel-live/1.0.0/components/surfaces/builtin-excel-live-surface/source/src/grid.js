import { formatA1, indexToCol, parseA1 } from './a1.js';
import { callExcel } from './backend.js';
import { scheduleFocusSync, setFocusFromSelection } from './focus.js';
import {
  activeSheet,
  cellDisplayValue,
  cellEditValue,
  mergeReadIntoCache,
  normalizeFocusRange,
  proposalAfterDisplay,
  proposalBeforeDisplay,
  proposalCellSet,
  sheetBounds,
} from './model.js';
import {
  axisIndexAtOffset,
  axisOffset,
  axisSizeAt,
  cellStyle,
  normalizeSheetLayout,
  proposalLayoutStates,
  styleDifferences,
  styleToCss,
} from './formatting.js';
import {
  createEditingDraft,
  editingExpectedRevision,
  gridSelectionNeedsEditCommit,
  isComposingKey,
  isSaveShortcut,
} from './interaction.js';
import { state } from './state.js';
import { cellCacheKey, clamp, closestElement, rootElement } from './util.js';
import { t } from './i18n.js';
import { showToast, updateChrome, updateSelectionStats } from './views.js';

const HEADER_H = 26;
const ROW_H = 26;
const COL_W = 100;
const ROW_HEADER_W = 46;
const OVERSCAN_ROWS = 6;
const OVERSCAN_COLS = 3;
const TILE_ROWS = 40;
const TILE_COLS = 12;
const MAX_FETCH_CELLS = 4000;
const AUTOFIT_COL_W = 140;
const AUTOFIT_ROW_H = 32;

let domBound = false;
let gridResizeObserver = null;
let resizeRafPending = false;
let lastObservedGridSize = null;
let deferredGridSelection = null;

function sheetLayout(sheet = activeSheet()) {
  if (!sheet?.id) return normalizeSheetLayout(null);
  const proposalSheetId = state.proposal?.sheetId || state.activeSheetId;
  const proposalLayout = proposalSheetId === sheet.id ? proposalLayoutStates(state.proposal) : null;
  if (proposalLayout) return proposalLayout.after;
  return state.sheetLayouts.get(sheet.id) || normalizeSheetLayout(sheet.layout);
}

function columnLeft(col, layout = sheetLayout()) {
  return axisOffset(col, layout.columns, COL_W, AUTOFIT_COL_W);
}

function columnWidth(col, layout = sheetLayout()) {
  return axisSizeAt(col, layout.columns, COL_W, AUTOFIT_COL_W);
}

function rowTop(row, layout = sheetLayout()) {
  return axisOffset(row, layout.rows, ROW_H, AUTOFIT_ROW_H);
}

function rowHeight(row, layout = sheetLayout()) {
  return axisSizeAt(row, layout.rows, ROW_H, AUTOFIT_ROW_H);
}

function indexSet(start, end, frozenCount = 0) {
  const values = new Set();
  for (let index = 0; index < frozenCount; index += 1) values.add(index);
  for (let index = start; index <= end; index += 1) values.add(index);
  return [...values].sort((a, b) => a - b);
}

function q(selector) {
  return rootElement()?.querySelector(selector) || null;
}

function cellDomId(sheetId, row, col) {
  const safeSheet = String(sheetId || 'sheet').replace(/[^a-zA-Z0-9_-]/g, '-');
  return `el-cell-${safeSheet}-${row}-${col}`;
}

function rowHeaderDomId(sheetId, row) {
  const safeSheet = String(sheetId || 'sheet').replace(/[^a-zA-Z0-9_-]/g, '-');
  return `el-row-header-${safeSheet}-${row}`;
}

function scrollHost() {
  return q('[data-grid-scroll]');
}

/* ---------------------------------------------------------------- layout */

function layoutGrid() {
  const sheet = activeSheet();
  const host = scrollHost();
  if (!sheet || !host) return;
  const bounds = sheetBounds(sheet);
  const layout = sheetLayout(sheet);
  const gridWidth = columnLeft(bounds.cols, layout);
  const gridHeight = rowTop(bounds.rows, layout);

  const corner = q('[data-grid-corner]');
  const colHeaders = q('[data-col-headers]');
  const rowHeaders = q('[data-row-headers]');
  const body = q('[data-grid-body]');
  if (corner) {
    corner.style.width = `${ROW_HEADER_W}px`;
    corner.style.height = `${HEADER_H}px`;
  }
  if (colHeaders) {
    colHeaders.style.width = `${gridWidth}px`;
    colHeaders.style.height = `${HEADER_H}px`;
  }
  if (rowHeaders) {
    rowHeaders.style.width = `${ROW_HEADER_W}px`;
    rowHeaders.style.height = `${gridHeight}px`;
  }
  if (body) {
    body.style.width = `${gridWidth}px`;
    body.style.height = `${gridHeight}px`;
    body.classList.toggle('has-custom-layout', layout.columns.length > 0 || layout.rows.length > 0);
    body.dataset.freezeRows = String(layout.freezePanes.rows || 0);
    body.dataset.freezeColumns = String(layout.freezePanes.columns || 0);
  }
}

function measureViewport() {
  const host = scrollHost();
  if (!host) return;
  const height = host.clientHeight || 480;
  const width = host.clientWidth || 800;
  const layout = sheetLayout();
  const smallestRow = Math.min(ROW_H, ...layout.rows.map((entry) => entry.size ?? AUTOFIT_ROW_H));
  const smallestCol = Math.min(COL_W, ...layout.columns.map((entry) => entry.size ?? AUTOFIT_COL_W));
  state.viewport.visibleRows = Math.min(200, Math.max(8, Math.ceil((height - HEADER_H) / smallestRow) + 2));
  state.viewport.visibleCols = Math.min(50, Math.max(4, Math.ceil((width - ROW_HEADER_W) / smallestCol) + 2));
}

function renderWindow() {
  const sheet = activeSheet();
  if (!sheet) return null;
  const bounds = sheetBounds(sheet);
  const { scrollRow, scrollCol, visibleRows, visibleCols } = state.viewport;
  return {
    sheet,
    bounds,
    r1: Math.max(0, scrollRow - OVERSCAN_ROWS),
    c1: Math.max(0, scrollCol - OVERSCAN_COLS),
    r2: Math.min(bounds.rows - 1, scrollRow + visibleRows - 1 + OVERSCAN_ROWS),
    c2: Math.min(bounds.cols - 1, scrollCol + visibleCols - 1 + OVERSCAN_COLS),
  };
}

/* ---------------------------------------------------------------- render */

function escapeText(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function renderGridBody(force = false) {
  const win = renderWindow();
  const cells = q('[data-grid-cells]');
  const colHeader = q('[data-col-headers]');
  const rowHeader = q('[data-row-headers]');
  if (!win || !cells || !colHeader || !rowHeader) return;

  const windowKey = `${win.sheet.id}:${win.r1}:${win.c1}:${win.r2}:${win.c2}`;
  if (!force && windowKey === state.lastRenderedWindow) {
    updateOverlays();
    return;
  }
  state.lastRenderedWindow = windowKey;

  const focus = normalizeFocusRange(state.focus, win.sheet);
  const layout = sheetLayout(win.sheet);
  const host = scrollHost();
  const freezeRows = Math.min(win.bounds.rows, state.viewport.visibleRows, layout.freezePanes.rows || 0);
  const freezeCols = Math.min(win.bounds.cols, state.viewport.visibleCols, layout.freezePanes.columns || 0);
  const rows = indexSet(win.r1, win.r2, freezeRows);
  const cols = indexSet(win.c1, win.c2, freezeCols);
  const customGrid = layout.columns.length > 0 || layout.rows.length > 0;
  let filterRange = null;
  if (layout.autoFilter?.a1) {
    try {
      filterRange = parseA1(layout.autoFilter.a1);
    } catch (_error) {
      filterRange = null;
    }
  }
  let colHtml = '';
  for (const c of cols) {
    const frozen = c < freezeCols;
    const filtered = filterRange && c >= filterRange.c1 && c <= filterRange.c2;
    const translate = frozen ? `transform:translateX(${host?.scrollLeft || 0}px);` : '';
    colHtml += `<div class="el-grid__col-h${frozen ? ' is-frozen' : ''}${filtered ? ' has-filter' : ''}" role="columnheader" aria-colindex="${c + 1}" data-col-h="${c}"${frozen ? ' data-freeze-x' : ''} style="left:${columnLeft(c, layout)}px;width:${columnWidth(c, layout)}px;height:${HEADER_H}px;${translate}">${indexToCol(c)}${filtered ? `<span class="el-grid__filter" aria-label="${escapeText(t('autoFilterActive'))}">⌄</span>` : ''}</div>`;
  }
  colHeader.innerHTML = colHtml;

  let rowHtml = '';
  for (const r of rows) {
    const frozen = r < freezeRows;
    const translate = frozen ? `transform:translateY(${host?.scrollTop || 0}px);` : '';
    rowHtml += `<div class="el-grid__row-header-row${frozen ? ' is-frozen' : ''}"${frozen ? ' data-freeze-y' : ''} style="top:${rowTop(r, layout)}px;width:${ROW_HEADER_W}px;height:${rowHeight(r, layout)}px;${translate}"><div id="${rowHeaderDomId(win.sheet.id, r)}" class="el-grid__row-h" role="rowheader" aria-rowindex="${r + 2}" data-row-h="${r}" style="width:${ROW_HEADER_W}px;height:${rowHeight(r, layout)}px">${r + 1}</div></div>`;
  }
  rowHeader.innerHTML = rowHtml;

  const proposals = proposalCellSet();
  let html = '';
  for (const r of rows) {
    const frozenRow = r < freezeRows;
    let rowCells = '';
    for (const c of cols) {
      const cell = state.cells.get(cellCacheKey(win.sheet.id, r, c));
      const proposal = proposals.get(`${r},${c}`);
      const isActive = r === focus.r1 && c === focus.c1;
      const isSelected = r >= focus.r1 && r <= focus.r2 && c >= focus.c1 && c <= focus.c2;
      if (!cell && !proposal && !isActive && !customGrid) continue;
      const display = cellDisplayValue(cell);
      const beforeDisplay = proposal ? (display || proposalBeforeDisplay(proposal)) : display;
      const classes = ['el-grid__cell'];
      if (typeof cell?.v === 'number') classes.push('is-num');
      if (cell?.f || cell?.formulaEvidence) classes.push('is-formula');
      if (proposal) classes.push('is-proposal');
      const presentationCell = proposal?.after || cell;
      const presentationStyle = cellStyle(presentationCell);
      if (presentationStyle.role) classes.push(`is-style-${presentationStyle.role}`);
      if (proposal && styleDifferences(proposal.before, proposal.after).length > 0) {
        classes.push('has-style-change');
      }
      const frozenCol = c < freezeCols;
      if (frozenRow) classes.push('is-frozen-row');
      if (frozenCol) classes.push('is-frozen-column');
      if (freezeRows > 0 && r === freezeRows - 1) classes.push('is-freeze-row-edge');
      if (freezeCols > 0 && c === freezeCols - 1) classes.push('is-freeze-column-edge');
      const domId = cellDomId(win.sheet.id, r, c);
      const a1 = formatA1(r, c);
      const proposalLabel = proposal
        ? `${t('proposalCellAria', { cell: a1, before: beforeDisplay || t('emptyValue'), after: proposalAfterDisplay(proposal) || t('emptyValue') })}`
        : `${a1}: ${display || t('emptyValue')}`;
      const cellCss = styleToCss(presentationCell?.style, presentationCell?.styleRole || presentationCell?.role);
      const translateX = frozenCol ? `transform:translateX(${host?.scrollLeft || 0}px);` : '';
      rowCells += `<div id="${domId}" role="gridcell" aria-colindex="${c + 1}" aria-selected="${isSelected}" aria-label="${escapeText(proposalLabel)}" class="${classes.join(' ')}" data-row="${r}" data-col="${c}"${frozenCol ? ' data-freeze-x' : ''}${presentationStyle.role ? ` data-style-role="${presentationStyle.role}"` : ''} style="left:${columnLeft(c, layout)}px;top:0;width:${columnWidth(c, layout)}px;height:${rowHeight(r, layout)}px;${translateX}${cellCss}">`;
      if (proposal) {
        const after = proposalAfterDisplay(proposal);
        if (beforeDisplay) {
          rowCells += `<span class="el-grid__old">${escapeText(beforeDisplay)}</span>`;
        }
        rowCells += `<span class="el-grid__new">${escapeText(after)}</span>`;
      } else {
        rowCells += `<span class="el-grid__value">${escapeText(display)}</span>`;
      }
      rowCells += '</div>';
    }
    const translateY = frozenRow ? `transform:translateY(${host?.scrollTop || 0}px);` : '';
    html += `<div class="el-grid__aria-row${frozenRow ? ' is-frozen' : ''}" role="row" aria-rowindex="${r + 2}" aria-labelledby="${rowHeaderDomId(win.sheet.id, r)}"${frozenRow ? ' data-freeze-y' : ''} style="top:${rowTop(r, layout)}px;width:${columnLeft(win.bounds.cols, layout)}px;height:${rowHeight(r, layout)}px;${translateY}">${rowCells}</div>`;
  }
  cells.innerHTML = html;
  updateOverlays();
}

function updateOverlays() {
  const selBox = q('[data-selection-box]');
  const activeBox = q('[data-active-box]');
  if (!selBox || !activeBox) return;
  const sheet = activeSheet();
  if (!sheet || !state.workbookId) {
    selBox.hidden = true;
    activeBox.hidden = true;
    return;
  }
  const focus = normalizeFocusRange(state.focus, sheet);
  const layout = sheetLayout(sheet);
  const host = scrollHost();
  const grid = q('[data-grid-wrap]');
  if (grid) {
    const bounds = sheetBounds(sheet);
    grid.setAttribute('aria-rowcount', String(bounds.rows + 1));
    grid.setAttribute('aria-colcount', String(bounds.cols));
    grid.setAttribute('aria-activedescendant', 'el-grid-active-cell');
    grid.setAttribute('aria-busy', state.loading || state.dialogPending || state.modePending ? 'true' : 'false');
  }
  const activeProxy = q('[data-active-gridcell]');
  if (activeProxy) {
    const activeCell = state.cells.get(cellCacheKey(sheet.id, focus.r1, focus.c1));
    const value = cellDisplayValue(activeCell) || t('emptyValue');
    const proposal = proposalCellSet().get(`${focus.r1},${focus.c1}`);
    const label = proposal
      ? t('proposalCellAria', {
        cell: formatA1(focus.r1, focus.c1),
        before: proposalBeforeDisplay(proposal) || value,
        after: proposalAfterDisplay(proposal) || t('emptyValue'),
      })
      : `${formatA1(focus.r1, focus.c1)}: ${value}`;
    activeProxy.setAttribute('aria-colindex', String(focus.c1 + 1));
    activeProxy.setAttribute('aria-label', label);
  }
  const activeProxyRow = q('[data-active-grid-row]');
  if (activeProxyRow) activeProxyRow.setAttribute('aria-rowindex', String(focus.r1 + 2));
  q('[data-grid-cells]')?.querySelectorAll('[role="gridcell"]').forEach((cellNode) => {
    const row = Number(cellNode.dataset.row);
    const col = Number(cellNode.dataset.col);
    const selected = row >= focus.r1 && row <= focus.r2 && col >= focus.c1 && col <= focus.c2;
    cellNode.setAttribute('aria-selected', selected ? 'true' : 'false');
  });
  const announcer = q('[data-grid-announcer]');
  if (announcer) {
    announcer.textContent = t('selectionAnnouncement', {
      sheet: sheet.name || '',
      a1: focus.a1,
      rows: focus.rowCount,
      cols: focus.columnCount,
    });
  }

  selBox.hidden = focus.rowCount === 1 && focus.columnCount === 1;
  selBox.style.left = `${columnLeft(focus.c1, layout)}px`;
  selBox.style.top = `${rowTop(focus.r1, layout)}px`;
  selBox.style.width = `${columnLeft(focus.c2 + 1, layout) - columnLeft(focus.c1, layout)}px`;
  selBox.style.height = `${rowTop(focus.r2 + 1, layout) - rowTop(focus.r1, layout)}px`;
  selBox.style.transform = `translate(${focus.c2 < layout.freezePanes.columns ? host?.scrollLeft || 0 : 0}px, ${focus.r2 < layout.freezePanes.rows ? host?.scrollTop || 0 : 0}px)`;

  activeBox.hidden = false;
  activeBox.style.left = `${columnLeft(focus.c1, layout)}px`;
  activeBox.style.top = `${rowTop(focus.r1, layout)}px`;
  activeBox.style.width = `${columnWidth(focus.c1, layout)}px`;
  activeBox.style.height = `${rowHeight(focus.r1, layout)}px`;
  activeBox.style.transform = `translate(${focus.c1 < layout.freezePanes.columns ? host?.scrollLeft || 0 : 0}px, ${focus.r1 < layout.freezePanes.rows ? host?.scrollTop || 0 : 0}px)`;

  updateNameBox();
  updateFormulaBar();
  updateSelectionStats();
  syncEditOverlay();
}

function updateFrozenTransforms() {
  const host = scrollHost();
  if (!host) return;
  q('[data-col-headers]')?.querySelectorAll('[data-freeze-x]').forEach((node) => {
    node.style.transform = `translateX(${host.scrollLeft}px)`;
  });
  q('[data-row-headers]')?.querySelectorAll('[data-freeze-y]').forEach((node) => {
    node.style.transform = `translateY(${host.scrollTop}px)`;
  });
  q('[data-grid-cells]')?.querySelectorAll('[data-freeze-x]').forEach((node) => {
    node.style.transform = `translateX(${host.scrollLeft}px)`;
  });
  q('[data-grid-cells]')?.querySelectorAll('[data-freeze-y]').forEach((node) => {
    node.style.transform = `translateY(${host.scrollTop}px)`;
  });
}

function updateNameBox() {
  const input = q('[data-namebox]');
  if (!input || document.activeElement === input) return;
  const focus = normalizeFocusRange(state.focus);
  input.value = focus.a1;
}

function updateFormulaBar() {
  const input = q('[data-formula-input]');
  if (!input || document.activeElement === input) return;
  if (state.editing) {
    input.value = state.editing.value;
    return;
  }
  const focus = normalizeFocusRange(state.focus);
  const sheet = activeSheet();
  if (!sheet) {
    input.value = '';
    return;
  }
  const cell = state.cells.get(cellCacheKey(sheet.id, focus.r1, focus.c1));
  input.value = cellEditValue(cell);
}

/* ----------------------------------------------------------- data fetch */

function tilesForWindow(win) {
  const tiles = [];
  const tr1 = Math.floor(win.r1 / TILE_ROWS);
  const tr2 = Math.floor(win.r2 / TILE_ROWS);
  const tc1 = Math.floor(win.c1 / TILE_COLS);
  const tc2 = Math.floor(win.c2 / TILE_COLS);
  for (let tr = tr1; tr <= tr2; tr += 1) {
    for (let tc = tc1; tc <= tc2; tc += 1) {
      tiles.push({ tr, tc, key: `${win.sheet.id}:${tr}:${tc}` });
    }
  }
  return tiles;
}

async function refreshViewportCells() {
  const win = renderWindow();
  if (!win || !state.workbookId) return;
  const sheet = win.sheet;
  const bounds = win.bounds;

  if (state.fetchedTiles.has(`${sheet.id}:all`)) return;

  // Small sheets fit in one read; fetch everything once and stop refetching.
  if (bounds.rows * bounds.cols <= MAX_FETCH_CELLS) {
    const a1 = formatA1(0, 0, bounds.rows - 1, bounds.cols - 1);
    const result = await callExcel('readRange', {
      workbookId: state.workbookId,
      sheetId: sheet.id,
      a1,
      maxCells: MAX_FETCH_CELLS,
    });
    mergeReadIntoCache(result);
    state.fetchedTiles.add(`${sheet.id}:all`);
    return;
  }

  const missing = tilesForWindow(win).filter((tile) => !state.fetchedTiles.has(tile.key));
  if (missing.length === 0) return;

  let r1 = Infinity;
  let c1 = Infinity;
  let r2 = -Infinity;
  let c2 = -Infinity;
  for (const tile of missing) {
    r1 = Math.min(r1, tile.tr * TILE_ROWS);
    c1 = Math.min(c1, tile.tc * TILE_COLS);
    r2 = Math.max(r2, tile.tr * TILE_ROWS + TILE_ROWS - 1);
    c2 = Math.max(c2, tile.tc * TILE_COLS + TILE_COLS - 1);
  }
  r1 = Math.max(0, r1);
  c1 = Math.max(0, c1);
  r2 = Math.min(bounds.rows - 1, r2);
  c2 = Math.min(bounds.cols - 1, c2);
  if ((r2 - r1 + 1) * (c2 - c1 + 1) > MAX_FETCH_CELLS) {
    r1 = win.r1;
    c1 = win.c1;
    r2 = win.r2;
    c2 = win.c2;
  }

  const result = await callExcel('readRange', {
    workbookId: state.workbookId,
    sheetId: sheet.id,
    a1: formatA1(r1, c1, r2, c2),
    maxCells: MAX_FETCH_CELLS,
  });
  mergeReadIntoCache(result);

  for (const tile of missing) {
    const tileR2 = tile.tr * TILE_ROWS + TILE_ROWS - 1;
    const tileC2 = tile.tc * TILE_COLS + TILE_COLS - 1;
    if (tile.tr * TILE_ROWS >= r1 && Math.min(tileR2, bounds.rows - 1) <= r2
      && tile.tc * TILE_COLS >= c1 && Math.min(tileC2, bounds.cols - 1) <= c2) {
      state.fetchedTiles.add(tile.key);
    }
  }
}

function scheduleViewportFetch() {
  if (state.viewportFetchTimer) clearTimeout(state.viewportFetchTimer);
  state.viewportFetchTimer = setTimeout(() => {
    state.viewportFetchTimer = null;
    void refreshViewportCells()
      .then(() => {
        layoutGrid();
        measureViewport();
        renderGridBody(true);
        // Refresh ambient context after hydration so an earlier
        // cache-incomplete focus is replaced by a grounded preview.
        scheduleFocusSync({ force: true, immediate: true, broadcast: false });
      })
      .catch((error) => {
        showToast('error', error?.message || String(error));
      });
  }, 120);
}

/* ------------------------------------------------------------ scrolling */

function scrollToCell(row, col) {
  const host = scrollHost();
  if (!host) return;
  const viewTop = host.scrollTop;
  const viewLeft = host.scrollLeft;
  const viewH = host.clientHeight - HEADER_H;
  const viewW = host.clientWidth - ROW_HEADER_W;
  const layout = sheetLayout();
  const cellTop = rowTop(row, layout);
  const cellLeft = columnLeft(col, layout);
  const cellH = rowHeight(row, layout);
  const cellW = columnWidth(col, layout);

  let nextTop = viewTop;
  let nextLeft = viewLeft;
  if (cellTop < viewTop) nextTop = cellTop;
  else if (cellTop + cellH > viewTop + viewH) nextTop = cellTop + cellH - viewH;
  if (cellLeft < viewLeft) nextLeft = cellLeft;
  else if (cellLeft + cellW > viewLeft + viewW) nextLeft = cellLeft + cellW - viewW;

  if (nextTop !== viewTop || nextLeft !== viewLeft) {
    host.scrollTo({ top: Math.max(0, nextTop), left: Math.max(0, nextLeft) });
  }
}

let scrollRafPending = false;

function applyScrollPosition() {
  const host = scrollHost();
  const sheet = activeSheet();
  if (!host || !sheet) return;
  const bounds = sheetBounds(sheet);
  const layout = sheetLayout(sheet);
  const nextRow = clamp(axisIndexAtOffset(host.scrollTop, bounds.rows, layout.rows, ROW_H, AUTOFIT_ROW_H), 0, Math.max(0, bounds.rows - 1));
  const nextCol = clamp(axisIndexAtOffset(host.scrollLeft, bounds.cols, layout.columns, COL_W, AUTOFIT_COL_W), 0, Math.max(0, bounds.cols - 1));
  updateFrozenTransforms();
  updateOverlays();
  if (nextRow === state.viewport.scrollRow && nextCol === state.viewport.scrollCol) return;
  state.viewport.scrollRow = nextRow;
  state.viewport.scrollCol = nextCol;
  renderGridBody(false);
  scheduleViewportFetch();
}

function handleScroll() {
  if (scrollRafPending) return;
  scrollRafPending = true;
  requestAnimationFrame(() => {
    scrollRafPending = false;
    applyScrollPosition();
  });
}

/* -------------------------------------------------------------- editing */

function canEdit() {
  return !state.loading
    && !state.dialogPending
    && !state.modePending
    && state.mode !== 'inspect'
    && Boolean(state.workbookId);
}

function handleViewportResize() {
  const host = scrollHost();
  if (!host || host.clientWidth <= 0 || host.clientHeight <= 0) return;
  const nextSize = `${host.clientWidth}x${host.clientHeight}`;
  if (nextSize === lastObservedGridSize) return;
  lastObservedGridSize = nextSize;
  measureViewport();
  renderGridBody(false);
  scheduleViewportFetch();
}

function scheduleViewportResize() {
  if (resizeRafPending) return;
  resizeRafPending = true;
  requestAnimationFrame(() => {
    resizeRafPending = false;
    handleViewportResize();
  });
}

function beginEdit(row, col, initialValue) {
  if (!canEdit()) return;
  const sheet = activeSheet();
  if (!sheet) return;
  const cell = state.cells.get(cellCacheKey(sheet.id, row, col));
  const value = initialValue != null ? initialValue : cellEditValue(cell);
  state.editing = createEditingDraft({
    row,
    col,
    value,
    workbookId: state.workbookId,
    sheetId: sheet.id,
    revision: state.meta?.revision ?? null,
    origin: 'cell',
  });
  setFocusFromSelection(row, col, row, col, { sync: true });
  scrollToCell(row, col);
  updateOverlays();
}

function syncEditOverlay() {
  const overlay = q('[data-cell-editor]');
  if (!overlay) return;
  if (!state.editing || state.editing.origin === 'formula') {
    overlay.hidden = true;
    return;
  }
  const { row, col } = state.editing;
  const layout = sheetLayout();
  overlay.hidden = false;
  overlay.style.left = `${columnLeft(col, layout)}px`;
  overlay.style.top = `${rowTop(row, layout)}px`;
  overlay.style.width = `${columnWidth(col, layout)}px`;
  overlay.style.height = `${rowHeight(row, layout)}px`;
  const input = overlay.querySelector('input');
  if (input && document.activeElement !== input) {
    input.value = state.editing.value;
    input.focus();
    input.select();
  }
}

function notifyEditingSettled() {
  document.dispatchEvent(new CustomEvent('excel-live:editing-settled'));
}

function restoreEditingFocus(editing) {
  queueMicrotask(() => {
    if (state.editing !== editing) return;
    if (editing.origin === 'formula') {
      const formulaInput = q('[data-formula-input]');
      if (formulaInput && !formulaInput.disabled) {
        formulaInput.value = editing.value;
        formulaInput.focus({ preventScroll: true });
      }
      return;
    }
    updateOverlays();
  });
}

async function commitEdit(move = null) {
  if (state.editCommitPromise) return state.editCommitPromise;
  if (!state.editing || !state.workbookId) return true;
  if (!canEdit()) {
    showToast('error', t(state.mode === 'inspect' ? 'inspectEditBlocked' : 'operationPending'));
    return false;
  }
  const editing = state.editing;
  const sheet = state.sheets.find((candidate) => candidate.id === editing.sheetId) || activeSheet();
  if (!sheet || (editing.workbookId && editing.workbookId !== state.workbookId)) return false;

  const task = (async () => {
    const { row, col, value } = editing;
    const trimmed = String(value ?? '');
    const expectedRevision = editingExpectedRevision(editing, state.meta?.revision ?? undefined);
    const payload = {
      workbookId: state.workbookId,
      sheetId: sheet.id,
      row,
      col,
      baseRevision: expectedRevision,
      expectedRevision,
    };
    if (trimmed.startsWith('=')) {
      payload.formula = trimmed;
    } else {
      payload.value = trimmed;
    }

    state.editing = null;
    updateOverlays();
    state.loading = true;
    updateChrome();
    let committed = false;
    try {
      const result = await callExcel('applyLocalEdit', payload);
      if (result?.meta) {
        state.dirty = Boolean(result.meta.dirty);
        state.meta = result.meta;
      }
      const key = cellCacheKey(sheet.id, row, col);
      if (result?.edit?.after) {
        state.cells.set(key, {
          v: result.edit.after.v ?? null,
          f: result.edit.after.f ?? null,
          t: result.edit.after.t ?? null,
          formulaEvidence: Boolean(result.edit.after.formulaEvidence || result.edit.after.f),
          formulaType: result.edit.after.formulaType ?? null,
          formulaRef: result.edit.after.formulaRef ?? null,
          style: result.edit.after.style ?? null,
        });
      } else {
        state.cells.delete(key);
      }
      if (state.proposal) {
        const remaining = (state.proposal.cells || []).filter(
          (c) => !(Number(c.row ?? c.r) === row && Number(c.col ?? c.c) === col),
        );
        state.proposal = remaining.length ? { ...state.proposal, cells: remaining } : null;
      }
      if (result?.edit?.operationId) {
        state.history.canUndo = true;
        state.history.canRedo = false;
      }
      // Local edits already persist to the live workbook.json store (including
      // focus). Only refresh host ambient context so chat sees the new preview;
      // skip a second setFocus bridge round-trip.
      scheduleFocusSync({ force: true, immediate: true, broadcast: false });
      renderGridBody(true);
      updateChrome();
      document.dispatchEvent(new CustomEvent('excel-live:proposal-refresh'));
      document.dispatchEvent(new CustomEvent('excel-live:history-refresh'));
      committed = true;
    } catch (error) {
      showToast('error', error?.message || t('editFailed'));
    } finally {
      state.loading = false;
      updateChrome();
      if (committed) {
        notifyEditingSettled();
      } else {
        state.editing = editing;
        renderGridBody(true);
        restoreEditingFocus(editing);
      }
    }

    if (!committed) return false;
    if (move?.exit === true) {
      // Keep the browser's natural focus destination (Tab/click outside).
    } else if (move) {
      moveFocus(move.dr, move.dc, false);
    } else {
      focusGridWrap();
    }
    return true;
  })();

  state.editCommitPromise = task;
  try {
    return await task;
  } finally {
    if (state.editCommitPromise === task) state.editCommitPromise = null;
  }
}

function cancelEdit() {
  const hadEditing = Boolean(state.editing);
  state.editing = null;
  updateOverlays();
  focusGridWrap();
  if (hadEditing) notifyEditingSettled();
}

async function applyFormulaBarValue(value) {
  if (!canEdit()) return;
  const focus = normalizeFocusRange(state.focus);
  const sheet = activeSheet();
  if (!sheet) return;
  if (
    state.editing
    && state.editing.row === focus.r1
    && state.editing.col === focus.c1
    && state.editing.sheetId === sheet.id
  ) {
    state.editing.value = String(value ?? '');
  } else {
    state.editing = createEditingDraft({
      row: focus.r1,
      col: focus.c1,
      value,
      workbookId: state.workbookId,
      sheetId: sheet.id,
      revision: state.meta?.revision ?? null,
      origin: 'formula',
    });
  }
  return commitEdit();
}

async function clearSelectionCells() {
  if (!canEdit()) return;
  const focus = normalizeFocusRange(state.focus);
  const sheet = activeSheet();
  if (!sheet) return;
  state.loading = true;
  updateChrome();
  try {
    const result = await callExcel('clearRange', {
      workbookId: state.workbookId,
      sheetId: sheet.id,
      a1: focus.a1,
      baseRevision: state.meta?.revision ?? undefined,
      expectedRevision: state.meta?.revision ?? undefined,
    });
    if (result?.meta) {
      state.dirty = Boolean(result.meta.dirty);
      state.meta = result.meta;
    }
    for (let r = focus.r1; r <= focus.r2; r += 1) {
      for (let c = focus.c1; c <= focus.c2; c += 1) {
        state.cells.delete(cellCacheKey(sheet.id, r, c));
      }
    }
    state.status = t('statusCleared');
    // clearRange already persisted cells + focus-adjacent state; host-only sync.
    scheduleFocusSync({ force: true, immediate: true, broadcast: false });
    renderGridBody(true);
    updateChrome();
    document.dispatchEvent(new CustomEvent('excel-live:proposal-refresh'));
    document.dispatchEvent(new CustomEvent('excel-live:history-refresh'));
  } catch (error) {
    showToast('error', error?.message || t('clearFailed'));
  } finally {
    state.loading = false;
    updateChrome();
  }
}

/* ------------------------------------------------------------ selection */

function focusGridWrap() {
  const wrap = q('[data-grid-wrap]');
  if (wrap && document.activeElement !== wrap) {
    wrap.focus({ preventScroll: true });
  }
}

function cellFromEvent(event) {
  const node = closestElement(event.target, '[data-row][data-col].el-grid__cell');
  if (node) {
    return { row: Number(node.dataset.row), col: Number(node.dataset.col) };
  }
  // Empty cells are not rendered as DOM nodes; derive from body coordinates.
  const body = q('[data-grid-body]');
  if (!body || !closestElement(event.target, '[data-grid-body]')) return null;
  const rect = body.getBoundingClientRect();
  const x = event.clientX - rect.left;
  const y = event.clientY - rect.top;
  if (x < 0 || y < 0) return null;
  const sheet = activeSheet();
  if (!sheet) return null;
  const bounds = sheetBounds(sheet);
  const row = clamp(Math.floor(y / ROW_H), 0, bounds.rows - 1);
  const col = clamp(Math.floor(x / COL_W), 0, bounds.cols - 1);
  return { row, col };
}

function applyPointerSelection(anchor, current = anchor, dragging = true) {
  state.selectionDragging = dragging;
  state.selectionAnchor = { row: anchor.row, col: anchor.col };
  setFocusFromSelection(anchor.row, anchor.col, current.row, current.col);
  updateOverlays();
  focusGridWrap();
}

function completeDeferredGridSelection(record, committed) {
  if (deferredGridSelection !== record) return;
  deferredGridSelection = null;
  if (!committed || record.cancelled) return;
  const current = record.latestCell || record.anchor;
  applyPointerSelection(record.anchor, current, !record.released);
  if (record.released) {
    scheduleFocusSync({ force: true, broadcast: true });
  }
}

function handleBodyPointerDown(event) {
  if (event.button !== 0) return;
  if (closestElement(event.target, '[data-cell-editor]')) return;
  const cell = cellFromEvent(event);
  if (!cell) return;
  if (deferredGridSelection || state.editCommitPromise) {
    event.preventDefault();
    return;
  }
  const sheet = activeSheet();
  const targetCell = { ...cell, sheetId: sheet?.id || null };
  if (state.editing) {
    if (!gridSelectionNeedsEditCommit(state.editing, targetCell)) return;
    const record = {
      anchor: cell,
      latestCell: cell,
      pointerId: event.pointerId,
      released: false,
      cancelled: false,
    };
    deferredGridSelection = record;
    try {
      event.currentTarget?.setPointerCapture?.(event.pointerId);
    } catch (_error) {
      // Pointer capture is an enhancement; document-level handlers still
      // preserve the deferred selection within the surface.
    }
    event.preventDefault();
    void commitEdit({ exit: true })
      .then((committed) => completeDeferredGridSelection(record, committed))
      .catch(() => completeDeferredGridSelection(record, false));
    return;
  }
  applyPointerSelection(cell);
  event.preventDefault();
}

function handleBodyPointerMove(event) {
  if (
    deferredGridSelection
    && (deferredGridSelection.pointerId == null || deferredGridSelection.pointerId === event.pointerId)
  ) {
    const cell = cellFromEvent(event);
    if (cell) deferredGridSelection.latestCell = cell;
    event.preventDefault();
    return;
  }
  if (!state.selectionDragging || !state.selectionAnchor) return;
  const cell = cellFromEvent(event);
  if (!cell) return;
  const anchor = state.selectionAnchor;
  setFocusFromSelection(anchor.row, anchor.col, cell.row, cell.col);
  updateOverlays();
}

function handlePointerUp(event) {
  if (
    deferredGridSelection
    && (deferredGridSelection.pointerId == null || deferredGridSelection.pointerId === event.pointerId)
  ) {
    deferredGridSelection.released = true;
    deferredGridSelection.cancelled = event.type === 'pointercancel';
    event.preventDefault();
    return;
  }
  if (!state.selectionDragging) return;
  state.selectionDragging = false;
  // Selection settled — push ambient focus (with cell preview) to the host
  // and mirror it into the workbook store for agent tools.
  scheduleFocusSync({ force: true, broadcast: true });
}

function handleBodyDblClick(event) {
  const cell = cellFromEvent(event);
  if (!cell) return;
  beginEdit(cell.row, cell.col);
}

function handleHeaderPointerDown(event) {
  if (event.button !== 0) return;
  const sheet = activeSheet();
  if (!sheet) return;
  const bounds = sheetBounds(sheet);
  const colNode = closestElement(event.target, '[data-col-h]');
  const rowNode = closestElement(event.target, '[data-row-h]');
  const cornerNode = closestElement(event.target, '[data-grid-corner]');
  if (colNode) {
    const c = Number(colNode.dataset.colH);
    setFocusFromSelection(0, c, bounds.rows - 1, c, { kind: 'column' });
  } else if (rowNode) {
    const r = Number(rowNode.dataset.rowH);
    setFocusFromSelection(r, 0, r, bounds.cols - 1, { kind: 'row' });
  } else if (cornerNode) {
    setFocusFromSelection(0, 0, bounds.rows - 1, bounds.cols - 1, { kind: 'sheet' });
  } else {
    return;
  }
  updateOverlays();
  event.preventDefault();
  focusGridWrap();
}

function moveFocus(dRow, dCol, extend) {
  const sheet = activeSheet();
  if (!sheet) return;
  const bounds = sheetBounds(sheet);
  const focus = normalizeFocusRange(state.focus);
  if (extend) {
    const nextR2 = clamp(focus.r2 + dRow, 0, bounds.rows - 1);
    const nextC2 = clamp(focus.c2 + dCol, 0, bounds.cols - 1);
    setFocusFromSelection(focus.r1, focus.c1, nextR2, nextC2);
    scrollToCell(nextR2, nextC2);
  } else {
    const nextR = clamp(focus.r1 + dRow, 0, bounds.rows - 1);
    const nextC = clamp(focus.c1 + dCol, 0, bounds.cols - 1);
    setFocusFromSelection(nextR, nextC, nextR, nextC);
    scrollToCell(nextR, nextC);
  }
  updateOverlays();
  scheduleViewportFetch();
}

function jumpToA1(text) {
  const sheet = activeSheet();
  if (!sheet || !text) return;
  let parsed;
  try {
    parsed = parseA1(text);
  } catch (_error) {
    updateNameBox();
    return;
  }
  const bounds = sheetBounds(sheet);
  const r1 = clamp(parsed.r1, 0, bounds.rows - 1);
  const c1 = clamp(parsed.c1, 0, bounds.cols - 1);
  const r2 = clamp(parsed.r2, 0, bounds.rows - 1);
  const c2 = clamp(parsed.c2, 0, bounds.cols - 1);
  setFocusFromSelection(r1, c1, r2, c2);
  scrollToCell(r1, c1);
  updateOverlays();
  scheduleViewportFetch();
  focusGridWrap();
}

/* ------------------------------------------------------------- keyboard */

function handleGridKeyDown(event) {
  const wrap = q('[data-grid-wrap]');
  if (!wrap || !state.workbookId) return;
  const target = event.target;
  const tag = target?.tagName;
  if (isComposingKey(event)) return;
  const modified = event.ctrlKey || event.metaKey;
  const lowerKey = event.key.toLowerCase();

  if (isSaveShortcut(event)) {
    event.preventDefault();
    if (state.editing) {
      void commitEdit({ exit: true }).then((committed) => {
        if (committed) document.dispatchEvent(new CustomEvent('excel-live:save'));
      });
    } else {
      document.dispatchEvent(new CustomEvent('excel-live:save'));
    }
    return;
  }

  if (tag === 'INPUT' || tag === 'TEXTAREA') {
    const isFormula = target?.dataset?.formulaInput != null;
    const isEditor = Boolean(target?.closest?.('[data-cell-editor]'));
    const isNameBox = target?.dataset?.namebox != null;
    if (isNameBox) {
      if (event.key === 'Enter') {
        event.preventDefault();
        jumpToA1(target.value);
      } else if (event.key === 'Escape') {
        event.preventDefault();
        updateNameBox();
        focusGridWrap();
      }
      return;
    }
    if (isFormula || isEditor) {
      if (event.key === 'Enter') {
        event.preventDefault();
        if (isFormula) {
          void applyFormulaBarValue(target.value);
        } else {
          void commitEdit({ dr: 1, dc: 0 });
        }
      } else if (event.key === 'Tab' && isEditor) {
        // Commit, but preserve native Tab traversal out of the ARIA grid.
        void commitEdit({ exit: true });
      } else if (event.key === 'Escape') {
        event.preventDefault();
        cancelEdit();
        updateFormulaBar();
      }
    }
    return;
  }

  const root = rootElement();
  const inGrid = Boolean(
    wrap.contains(target)
    || target === wrap
    || target === document.body
    || target === root
    || (root && root.contains(target) && !['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(tag)),
  );
  if (modified && lowerKey === 'c' && inGrid) {
    event.preventDefault();
    document.dispatchEvent(new CustomEvent('excel-live:copy'));
    return;
  }
  if (modified && lowerKey === 'v' && inGrid) {
    event.preventDefault();
    document.dispatchEvent(new CustomEvent('excel-live:paste'));
    return;
  }
  if (modified && lowerKey === 'z' && inGrid) {
    event.preventDefault();
    document.dispatchEvent(new CustomEvent(event.shiftKey ? 'excel-live:redo' : 'excel-live:undo'));
    return;
  }
  if (modified && lowerKey === 'y' && inGrid) {
    event.preventDefault();
    document.dispatchEvent(new CustomEvent('excel-live:redo'));
    return;
  }

  if (state.editing) return;
  // Accept key events when the grid wrap (or anything inside it) is focused,
  // or when focus is on body/root after a cell click that used preventDefault.
  if (!inGrid) return;

  const extend = event.shiftKey;
  switch (event.key) {
    case 'ArrowUp':
      event.preventDefault();
      moveFocus(-1, 0, extend);
      break;
    case 'ArrowDown':
      event.preventDefault();
      moveFocus(1, 0, extend);
      break;
    case 'ArrowLeft':
      event.preventDefault();
      moveFocus(0, -1, extend);
      break;
    case 'ArrowRight':
      event.preventDefault();
      moveFocus(0, 1, extend);
      break;
    case 'Tab':
      // ARIA grids are single Tab stops; arrow keys navigate inside, while
      // Tab and Shift+Tab leave the grid normally.
      break;
    case 'PageDown':
      event.preventDefault();
      moveFocus(Math.max(1, state.viewport.visibleRows - 2), 0, extend);
      break;
    case 'PageUp':
      event.preventDefault();
      moveFocus(-Math.max(1, state.viewport.visibleRows - 2), 0, extend);
      break;
    case 'Home':
      event.preventDefault();
      jumpToA1('A1');
      break;
    case 'Enter':
    case 'F2':
      event.preventDefault();
      beginEdit(state.focus.r1, state.focus.c1);
      break;
    case 'Delete':
    case 'Backspace':
      event.preventDefault();
      void clearSelectionCells();
      break;
    default:
      if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
        beginEdit(state.focus.r1, state.focus.c1, event.key);
        event.preventDefault();
      }
      break;
  }
}

/* -------------------------------------------------------------- binding */

function bindGridDom() {
  if (domBound) return;
  const host = scrollHost();
  const body = q('[data-grid-body]');
  const pin = q('.el-grid__pin');
  const rowHeaders = q('[data-row-headers]');
  const editorInput = q('[data-cell-editor] input');
  const formulaInput = q('[data-formula-input]');
  if (!host || !body) return;
  domBound = true;

  host.addEventListener('scroll', handleScroll, { passive: true });
  body.addEventListener('pointerdown', handleBodyPointerDown);
  body.addEventListener('dblclick', handleBodyDblClick);
  document.addEventListener('pointermove', handleBodyPointerMove);
  document.addEventListener('pointerup', handlePointerUp);
  document.addEventListener('pointercancel', handlePointerUp);
  if (pin) pin.addEventListener('pointerdown', handleHeaderPointerDown);
  if (rowHeaders) rowHeaders.addEventListener('pointerdown', handleHeaderPointerDown);
  document.addEventListener('keydown', handleGridKeyDown);

  if (editorInput) {
    editorInput.addEventListener('input', () => {
      if (!state.editing) return;
      state.editing.value = editorInput.value;
      const formula = q('[data-formula-input]');
      if (formula && document.activeElement !== formula) formula.value = editorInput.value;
    });
    editorInput.addEventListener('blur', () => {
      if (state.editing) void commitEdit({ exit: true });
    });
  }
  if (formulaInput) {
    formulaInput.addEventListener('input', () => {
      if (!canEdit()) return;
      if (!state.editing) {
        const focus = normalizeFocusRange(state.focus);
        const sheet = activeSheet();
        if (!sheet) return;
        state.editing = createEditingDraft({
          row: focus.r1,
          col: focus.c1,
          value: formulaInput.value,
          workbookId: state.workbookId,
          sheetId: sheet.id,
          revision: state.meta?.revision ?? null,
          origin: 'formula',
        });
      } else {
        state.editing.value = formulaInput.value;
      }
    });
    formulaInput.addEventListener('blur', () => {
      if (state.editing) void commitEdit({ exit: true });
    });
  }

  if (typeof ResizeObserver === 'function') {
    gridResizeObserver?.disconnect();
    gridResizeObserver = new ResizeObserver(scheduleViewportResize);
    gridResizeObserver.observe(host);
  }
  window.addEventListener('resize', scheduleViewportResize);
}

function renderGrid() {
  bindGridDom();
  layoutGrid();
  measureViewport();
  renderGridBody(true);
  // The first paint may happen before the real viewport size is known;
  // fetch any tiles the measured viewport needs (tile cache dedupes).
  scheduleViewportFetch();
}

function resetScrollPosition() {
  const host = scrollHost();
  if (host) {
    host.scrollTop = 0;
    host.scrollLeft = 0;
  }
  state.viewport.scrollRow = 0;
  state.viewport.scrollCol = 0;
}

export {
  applyFormulaBarValue,
  beginEdit,
  cancelEdit,
  clearSelectionCells,
  commitEdit,
  jumpToA1,
  measureViewport,
  refreshViewportCells,
  renderGrid,
  renderGridBody,
  resetScrollPosition,
  scheduleViewportFetch,
  scrollToCell,
  updateFormulaBar,
  updateNameBox,
  updateOverlays,
};
