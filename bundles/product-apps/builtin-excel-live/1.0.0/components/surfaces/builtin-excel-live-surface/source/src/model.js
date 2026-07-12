import { formatA1, parseA1 } from './a1.js';
import {
  LIVE_VIEW_SEMANTICS,
  cellDisplayWithStyle,
  normalizeSheetLayout,
  snapshotParts,
} from './formatting.js';
import { state } from './state.js';
import { cellCacheKey } from './util.js';

const FOCUS_PREVIEW_MAX_CELLS = 200;
const VALID_WORKBOOK_MODES = new Set(['inspect', 'edit', 'author']);
const FRESH_CALCULATION_STATES = new Set([
  'current',
  'ready',
  'calculated',
  'recalculated',
  'ok',
  'not-required',
]);

function calculationStatusToken(status = state.meta?.calculationStatus) {
  if (typeof status === 'string') return status.trim().toLowerCase().replaceAll('_', '-');
  if (!status || typeof status !== 'object') return '';
  return String(status.status || status.state || status.kind || '')
    .trim()
    .toLowerCase()
    .replaceAll('_', '-');
}

function calculationStatusIsFresh(status = state.meta?.calculationStatus) {
  return FRESH_CALCULATION_STATES.has(calculationStatusToken(status));
}

function cellHasFormulaEvidence(cell) {
  return Boolean(cell && (cell.formulaEvidence === true || (typeof cell.f === 'string' && cell.f.length > 0)));
}

function activeSheet() {
  return (state.sheets || []).find((sheet) => sheet.id === state.activeSheetId) || state.sheets?.[0] || null;
}

function sheetBounds(sheet = activeSheet()) {
  return {
    rows: Math.max(1, Number(sheet?.rows) || 50),
    cols: Math.max(1, Number(sheet?.cols) || 26),
  };
}

function normalizeFocusRange(focusLike = state.focus, sheet = activeSheet()) {
  const bounds = sheetBounds(sheet);
  let r1 = 0;
  let c1 = 0;
  let r2 = 0;
  let c2 = 0;
  if (focusLike?.a1) {
    try {
      const parsed = parseA1(focusLike.a1);
      r1 = parsed.r1;
      c1 = parsed.c1;
      r2 = parsed.r2;
      c2 = parsed.c2;
    } catch (_error) {
      // keep defaults
    }
  } else {
    r1 = Number(focusLike?.r1) || 0;
    c1 = Number(focusLike?.c1) || 0;
    r2 = Number(focusLike?.r2 ?? focusLike?.r1) || 0;
    c2 = Number(focusLike?.c2 ?? focusLike?.c1) || 0;
  }
  const startRow = Math.max(0, Math.min(Math.min(r1, r2), bounds.rows - 1));
  const startCol = Math.max(0, Math.min(Math.min(c1, c2), bounds.cols - 1));
  const endRow = Math.max(startRow, Math.min(Math.max(r1, r2), bounds.rows - 1));
  const endCol = Math.max(startCol, Math.min(Math.max(c1, c2), bounds.cols - 1));
  r1 = startRow;
  c1 = startCol;
  r2 = endRow;
  c2 = endCol;
  const a1 = formatA1(r1, c1, r2, c2);
  const kind = focusLike?.kind || (r1 === r2 && c1 === c2 ? 'cell' : 'range');
  return {
    sheetId: focusLike?.sheetId || sheet?.id || state.activeSheetId,
    sheetName: focusLike?.sheetName || sheet?.name || null,
    a1,
    kind,
    r1,
    c1,
    r2,
    c2,
    rowCount: r2 - r1 + 1,
    columnCount: c2 - c1 + 1,
  };
}

function cellDisplayValue(cell) {
  return cellDisplayWithStyle(cell);
}

function cellRawDisplayValue(cell) {
  if (!cell) return '';
  if (cell.v != null) return String(cell.v);
  const formula = cell.f ?? cell.formula;
  return formula ? `=${String(formula).replace(/^=/, '')}` : '';
}

function cellEditValue(cell) {
  if (!cell) return '';
  if (cell.f) return `=${cell.f}`;
  if (cell.v == null) return '';
  return String(cell.v);
}

function focusCacheCoverage(focus, sheet = activeSheet()) {
  if (!sheet || !focus) {
    return { loadedCells: 0, totalCells: 0, ratio: 0, complete: false };
  }
  const totalCells = Math.max(0, focus.rowCount * focus.columnCount);
  if (totalCells === 0) {
    return { loadedCells: 0, totalCells: 0, ratio: 1, complete: true };
  }

  // Iterate the virtualized cache rather than the whole selection. A whole
  // column/sheet focus can contain millions of cells while the cache remains
  // intentionally bounded to fetched tiles.
  const prefix = `${sheet.id}:`;
  let loadedCells = 0;
  for (const key of state.cells.keys()) {
    if (!key.startsWith(prefix)) continue;
    const coordinates = key.slice(prefix.length).split(',');
    const row = Number(coordinates[0]);
    const col = Number(coordinates[1]);
    if (
      Number.isInteger(row)
      && Number.isInteger(col)
      && row >= focus.r1
      && row <= focus.r2
      && col >= focus.c1
      && col <= focus.c2
    ) {
      loadedCells += 1;
    }
  }
  const boundedLoaded = Math.min(totalCells, loadedCells);
  return {
    loadedCells: boundedLoaded,
    totalCells,
    ratio: boundedLoaded / totalCells,
    complete: boundedLoaded === totalCells,
  };
}

function buildPreviewTsv(focus, sheet = activeSheet(), coverage = null) {
  if (!sheet) return null;
  const cellTotal = focus.rowCount * focus.columnCount;
  if (cellTotal <= 0 || cellTotal > FOCUS_PREVIEW_MAX_CELLS) return null;
  const resolvedCoverage = coverage || focusCacheCoverage(focus, sheet);
  if (!resolvedCoverage.complete) return null;
  const rows = [];
  for (let r = focus.r1; r <= focus.r2; r += 1) {
    const row = [];
    for (let c = focus.c1; c <= focus.c2; c += 1) {
      const cell = state.cells.get(cellCacheKey(sheet.id, r, c));
      // Agent focus remains grounded in raw workbook values/formulas; visual
      // number formatting is a Surface concern and must not rewrite evidence.
      row.push(cellRawDisplayValue(cell).replaceAll('\t', ' ').replaceAll('\n', ' '));
    }
    rows.push(row.join('\t'));
  }
  return rows.join('\n');
}

function selectionValueSummary(focus, sheet = activeSheet(), coverage = null) {
  if (!sheet) return null;
  const cellTotal = focus.rowCount * focus.columnCount;
  if (cellTotal <= 0 || cellTotal > 5000) return null;
  const resolvedCoverage = coverage || focusCacheCoverage(focus, sheet);
  if (!resolvedCoverage.complete) return null;
  let numericCount = 0;
  let textCount = 0;
  let emptyCount = 0;
  let formulaCount = 0;
  let sum = 0;
  for (let r = focus.r1; r <= focus.r2; r += 1) {
    for (let c = focus.c1; c <= focus.c2; c += 1) {
      const cell = state.cells.get(cellCacheKey(sheet.id, r, c));
      const hasFormula = cellHasFormulaEvidence(cell);
      if (!cell || (cell.v == null && !hasFormula)) {
        emptyCount += 1;
        continue;
      }
      if (hasFormula) formulaCount += 1;
      if (typeof cell.v === 'number') {
        numericCount += 1;
        sum += cell.v;
      } else if (cell.v != null && cell.v !== '') {
        textCount += 1;
      }
    }
  }
  return {
    cellCount: cellTotal,
    numericCount,
    textCount,
    emptyCount,
    formulaCount,
    sum,
    avg: numericCount > 0 ? sum / numericCount : null,
  };
}

function buildFocusPayload(role = 'ambient') {
  const sheet = activeSheet();
  const focus = normalizeFocusRange(state.focus, sheet);
  const coverage = focusCacheCoverage(focus, sheet);
  const summary = selectionValueSummary(focus, sheet, coverage);
  const cellTotal = focus.rowCount * focus.columnCount;
  const calculationStatus = state.meta?.calculationStatus || null;
  // Cached values are evidence only when the workbook explicitly reports a
  // fresh/not-required calculation state. Missing, cached, or stale metadata
  // is fail-closed even when the selected cells appear formula-free: shared
  // formula followers may not carry formula text of their own.
  const formulaResultsFresh = calculationStatusIsFresh(calculationStatus);
  const previewTsv = formulaResultsFresh
    ? buildPreviewTsv(focus, sheet, coverage)
    : null;
  const previewOmittedReason = !coverage.complete
    ? 'cache-incomplete'
    : !formulaResultsFresh && cellTotal <= FOCUS_PREVIEW_MAX_CELLS
      ? 'formula-results-stale'
    : cellTotal > FOCUS_PREVIEW_MAX_CELLS
      ? 'selection-too-large'
      : null;
  return {
    type: 'spreadsheet-focus',
    role,
    sessionId: state.sessionId || undefined,
    workbookId: state.workbookId,
    workbookPath: state.path || state.meta?.path || undefined,
    sheetId: focus.sheetId,
    sheetName: focus.sheetName || sheet?.name || undefined,
    a1: focus.a1,
    selectionKind: focus.kind,
    rowCount: focus.rowCount,
    columnCount: focus.columnCount,
    previewTsv: previewTsv || undefined,
    previewTruncated: cellTotal > FOCUS_PREVIEW_MAX_CELLS,
    previewOmitted: Boolean(previewOmittedReason),
    previewOmittedReason: previewOmittedReason || undefined,
    cacheCoverage: coverage.ratio,
    cacheComplete: coverage.complete,
    formulaResultsFresh,
    calculationStatus: calculationStatus || undefined,
    fidelity: {
      ...(state.meta?.fidelity || {}),
      liveViewSemantics: LIVE_VIEW_SEMANTICS,
      presentationSemanticsRendered: true,
      cellStylesRendered: true,
      commonNumberFormatsRendered: true,
      layoutMetadataRendered: true,
    },
    cacheLoadedCells: coverage.loadedCells,
    cacheTotalCells: coverage.totalCells,
    capturedAt: Date.now(),
    valueSummary: summary
      ? {
        cellCount: summary.cellCount,
        numericCount: formulaResultsFresh ? summary.numericCount : undefined,
        textCount: formulaResultsFresh ? summary.textCount : undefined,
        emptyCount: formulaResultsFresh ? summary.emptyCount : undefined,
        formulaCount: summary.formulaCount,
      }
      : undefined,
    includeFocusOnSend: state.includeFocusOnSend,
    mode: state.mode,
    revision: state.meta?.revision ?? undefined,
    schemaVersion: 1,
  };
}

function mergeReadIntoCache(readResult) {
  if (!readResult) return;
  const sheetId = readResult.sheetId || state.activeSheetId;
  if (!sheetId || !Array.isArray(readResult.values)) return;
  let range;
  try {
    range = parseA1(readResult.a1 || 'A1');
  } catch (_error) {
    return;
  }
  const formulaMap = new Map();
  for (const item of readResult.formulas || []) {
    formulaMap.set(`${item.row},${item.col}`, item);
  }
  const sparseCells = new Map();
  for (const item of readResult.cells || []) {
    const row = Number(item?.row ?? item?.r);
    const col = Number(item?.col ?? item?.c);
    if (!Number.isInteger(row) || !Number.isInteger(col)) continue;
    sparseCells.set(`${row},${col}`, item);
  }
  const styleMatrix = Array.isArray(readResult.styles)
    ? readResult.styles
    : Array.isArray(readResult.cellStyles)
      ? readResult.cellStyles
      : null;
  for (let i = 0; i < readResult.values.length; i += 1) {
    const rowVals = readResult.values[i] || [];
    for (let j = 0; j < rowVals.length; j += 1) {
      const row = range.r1 + i;
      const col = range.c1 + j;
      const key = cellCacheKey(sheetId, row, col);
      const formulaItem = formulaMap.get(`${row},${col}`) || null;
      const sparse = sparseCells.get(`${row},${col}`) || null;
      const rawValue = rowVals[j];
      const embedded = rawValue && typeof rawValue === 'object' && !Array.isArray(rawValue)
        ? rawValue
        : null;
      const value = embedded
        ? embedded.v ?? embedded.value ?? null
        : sparse
          ? sparse.v ?? sparse.value ?? rawValue
          : rawValue;
      const formula = sparse?.formula ?? sparse?.f ?? embedded?.formula ?? embedded?.f ?? formulaItem?.formula ?? null;
      const matrixStyle = styleMatrix?.[i]?.[j] || null;
      const style = sparse?.style || embedded?.style || formulaItem?.style || matrixStyle || null;
      state.cells.set(key, {
        v: value,
        f: formula,
        t: formula ? 'f' : sparse?.t ?? embedded?.t ?? (value == null ? null : typeof value === 'number' ? 'n' : 's'),
        formulaEvidence: Boolean(formula || sparse?.formulaEvidence || embedded?.formulaEvidence || formulaItem?.formulaEvidence),
        formulaType: sparse?.formulaType || embedded?.formulaType || formulaItem?.formulaType || null,
        formulaRef: sparse?.formulaRef || embedded?.formulaRef || formulaItem?.formulaRef || null,
        style,
      });
    }
  }
  // Styled empty cells can be omitted from values[][] yet still need to render.
  for (const [coordinates, sparse] of sparseCells) {
    const [row, col] = coordinates.split(',').map(Number);
    const key = cellCacheKey(sheetId, row, col);
    const existing = state.cells.get(key) || {};
    state.cells.set(key, {
      ...existing,
      v: sparse.v ?? sparse.value ?? existing.v ?? null,
      f: sparse.formula ?? sparse.f ?? existing.f ?? null,
      t: sparse.t ?? existing.t ?? null,
      formulaEvidence: Boolean(sparse.formulaEvidence || sparse.formula || sparse.f || existing.formulaEvidence),
      formulaType: sparse.formulaType || existing.formulaType || null,
      formulaRef: sparse.formulaRef || existing.formulaRef || null,
      style: sparse.style || existing.style || null,
    });
  }
  if (readResult.layout) {
    state.sheetLayouts.set(sheetId, normalizeSheetLayout(readResult.layout));
  }
}

function proposalCellSet(proposal = state.proposal) {
  const set = new Map();
  if (!proposal?.cells?.length) return set;
  const activeSheetId = state.activeSheetId;
  if (proposal.sheetId && activeSheetId && proposal.sheetId !== activeSheetId) return set;
  for (const cell of proposal.cells) {
    const cellSheetId = cell.sheetId || proposal.sheetId || activeSheetId;
    if (activeSheetId && cellSheetId && cellSheetId !== activeSheetId) continue;
    const row = Number(cell.row ?? cell.r);
    const col = Number(cell.col ?? cell.c);
    if (!Number.isInteger(row) || !Number.isInteger(col)) continue;
    set.set(`${row},${col}`, cell);
  }
  return set;
}

function applyMeta(meta) {
  if (!meta) return;
  const previousWorkbookId = state.workbookId;
  const nextWorkbookId = meta.workbookId || previousWorkbookId;
  const workbookChanged = Boolean(nextWorkbookId && previousWorkbookId !== nextWorkbookId);
  const hasPath = Object.prototype.hasOwnProperty.call(meta, 'path');
  const hasSourcePath = Object.prototype.hasOwnProperty.call(meta, 'sourcePath');
  state.meta = meta;
  state.workbookId = nextWorkbookId;
  if (workbookChanged) state.sheetLayouts.clear();
  // Workbook identity owns its source path. In particular, a native/new
  // workbook with a null path must never inherit the previous .xlsx/.xlsm
  // source merely because both workbooks reuse this surface instance.
  if (hasPath) {
    state.path = meta.path ?? null;
  } else if (hasSourcePath) {
    state.path = meta.sourcePath ?? null;
  } else if (workbookChanged) {
    state.path = null;
  }
  state.dirty = Boolean(meta.dirty);
  state.activeSheetId = meta.activeSheetId || state.activeSheetId;
  const persistedMode = String(meta.mode || '').trim().toLowerCase();
  if (VALID_WORKBOOK_MODES.has(persistedMode)) {
    state.mode = persistedMode;
  }
  if (Array.isArray(meta.sheets)) {
    state.sheets = meta.sheets;
    for (const sheet of meta.sheets) {
      if (sheet?.id && sheet.layout) {
        state.sheetLayouts.set(sheet.id, normalizeSheetLayout(sheet.layout));
      }
    }
  }
  if (meta.focus?.a1) {
    state.focus = normalizeFocusRange({
      ...meta.focus,
      sheetId: meta.focus.sheetId || state.activeSheetId,
    });
  }
}

function proposalSnapshotDisplay(snapshot) {
  return snapshotParts(snapshot).primary;
}

function proposalBeforeDisplay(cell) {
  return proposalSnapshotDisplay(cell?.before);
}

function proposalAfterDisplay(cell) {
  return proposalSnapshotDisplay(cell?.after);
}

export {
  FOCUS_PREVIEW_MAX_CELLS,
  activeSheet,
  applyMeta,
  buildFocusPayload,
  buildPreviewTsv,
  calculationStatusIsFresh,
  cellDisplayValue,
  cellRawDisplayValue,
  cellEditValue,
  mergeReadIntoCache,
  normalizeFocusRange,
  focusCacheCoverage,
  proposalAfterDisplay,
  proposalBeforeDisplay,
  proposalSnapshotDisplay,
  proposalCellSet,
  selectionValueSummary,
  sheetBounds,
};
