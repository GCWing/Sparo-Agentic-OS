import { callExcel } from './backend.js';
import {
  commitModeToBackend,
  pinFocus as pinFocusAction,
  setFocusFromSelection,
  syncFocusToHost,
} from './focus.js';
import {
  applyMeta,
  activeSheet,
  cellEditValue,
  focusCacheCoverage,
  mergeReadIntoCache,
  normalizeFocusRange,
} from './model.js';
import { acceptProposal, refreshProposal, rejectProposal } from './proposal.js';
import { refreshViewportCells, resetScrollPosition, scrollToCell } from './grid.js';
import { state, invalidateCells } from './state.js';
import { formatA1 } from './a1.js';
import { cellCacheKey, normalizePathForCompare, runtime } from './util.js';
import { t } from './i18n.js';
import { render } from './render.js';
import { showToast, updateChrome } from './views.js';
import { buildSelectionStyleCells, exportCopyPlan } from './interaction.js';

function setLoading(loading, status = null) {
  state.loading = loading;
  if (status != null) state.status = status;
  updateChrome();
}

function setError(error) {
  const message = error?.message || (typeof error === 'string' ? error : null);
  if (message) showToast('error', message);
}

function writeBoundaryBlocked() {
  if (state.loading || state.dialogPending) {
    setError(t('operationPending'));
    return true;
  }
  if (state.modePending) {
    setError(t('modeChangePending'));
    return true;
  }
  if (state.mode === 'inspect') {
    setError(t('inspectEditBlocked'));
    return true;
  }
  return false;
}

const MAX_FORMAT_PROPOSAL_CELLS = 5000;

async function proposeSelectionFormat(change = {}) {
  if (writeBoundaryBlocked() || !state.workbookId) return false;
  if (state.mode === 'inspect') {
    showToast('error', t('inspectEditBlocked'));
    return false;
  }
  if (state.proposal) {
    showToast('error', t('formatProposalExists'));
    return false;
  }
  const sheet = activeSheet();
  const focus = normalizeFocusRange(state.focus, sheet);
  if (!sheet) return false;
  const cellCount = focus.rowCount * focus.columnCount;
  if (cellCount > MAX_FORMAT_PROPOSAL_CELLS) {
    showToast('error', t('formatRangeTooLarge', { count: MAX_FORMAT_PROPOSAL_CELLS }));
    return false;
  }
  const styleRole = String(change.styleRole || '').trim() || null;
  const style = change.style && typeof change.style === 'object' ? change.style : null;
  if (!styleRole && !style) return false;
  const cells = buildSelectionStyleCells(focus, { styleRole, style }, MAX_FORMAT_PROPOSAL_CELLS);
  const intent = change.intent || t('formatIntent', { range: `${sheet.name}!${focus.a1}` });
  setLoading(true);
  try {
    const result = await callExcel('proposePatch', {
      workbookId: state.workbookId,
      sheetId: sheet.id,
      expectedRevision: state.meta?.revision ?? undefined,
      baseRevision: state.meta?.revision ?? undefined,
      intent,
      cells,
    });
    if (result?.meta) applyMeta(result.meta);
    await refreshProposal();
    if (!state.proposal) throw new Error(t('formatProposalMissing'));
    state.status = t('formatProposalReady');
    render();
    return true;
  } catch (error) {
    showToast('error', error?.message || t('formatProposalFailed'));
    return false;
  } finally {
    setLoading(false);
  }
}

function beginDialogBoundary() {
  if (state.loading || state.dialogPending || state.modePending) {
    setError(t(state.modePending ? 'modeChangePending' : 'operationPending'));
    return false;
  }
  state.dialogPending = true;
  updateChrome();
  return true;
}

function endDialogBoundary() {
  state.dialogPending = false;
  updateChrome();
}

function samePath(a, b) {
  if (!a || !b) return false;
  return normalizePathForCompare(a) === normalizePathForCompare(b);
}

function staleFormulaExportRisk(meta = state.meta) {
  const calculation = meta?.calculationStatus;
  if (calculation == null) return false;
  const token = String(
    typeof calculation === 'string'
      ? calculation
      : calculation.status || calculation.state || calculation.kind || '',
  ).trim().toLowerCase().replaceAll('_', '-');
  const formulaCount = typeof calculation === 'object'
    ? Number(calculation.formulaCount ?? calculation.formula_count)
    : Number.NaN;
  const hasFormulas = typeof calculation === 'object' && typeof calculation.hasFormulas === 'boolean'
    ? calculation.hasFormulas
    : Number.isFinite(formulaCount)
      ? formulaCount > 0
      : !['current', 'not-required'].includes(token);
  return hasFormulas && !['current', 'not-required'].includes(token);
}

function applyHistory(result) {
  const history = result?.history && typeof result.history === 'object' && !Array.isArray(result.history)
    ? result.history
    : result && typeof result === 'object'
      ? result
      : {};
  const entries = Array.isArray(history.entries)
    ? history.entries
    : Array.isArray(history.items)
      ? history.items
      : Array.isArray(result?.entries)
        ? result.entries
        : Array.isArray(result?.history)
          ? result.history
          : [];
  state.history = {
    canUndo: Boolean(history.canUndo ?? history.can_undo ?? entries.some((entry) => entry?.undoable !== false)),
    canRedo: Boolean(history.canRedo ?? history.can_redo),
    entries,
  };
}

async function refreshHistory() {
  if (!state.workbookId) {
    applyHistory(null);
    updateChrome();
    return state.history;
  }
  try {
    const result = await callExcel('getHistory', { workbookId: state.workbookId });
    applyHistory(result);
  } catch (_error) {
    // History is an enhancement; an unavailable history endpoint must not
    // block the workbook itself.
    applyHistory(null);
  }
  updateChrome();
  return state.history;
}

async function adoptWorkbookResult(result, statusKey, options = {}) {
  const resultMeta = result?.meta;
  const hasResultPath = resultMeta && (
    Object.prototype.hasOwnProperty.call(resultMeta, 'path')
    || Object.prototype.hasOwnProperty.call(resultMeta, 'sourcePath')
  );
  const meta = resultMeta && options.sourcePath && !hasResultPath
    ? { ...resultMeta, path: options.sourcePath }
    : resultMeta;
  applyMeta(meta);
  const persistedMode = state.mode;
  const modeOverride = ['inspect', 'edit', 'author'].includes(options.modeOverride)
    ? options.modeOverride
    : null;
  let modeOverrideCommitted = false;
  if (modeOverride && modeOverride !== persistedMode) {
    try {
      await commitModeToBackend(modeOverride);
      state.mode = modeOverride;
      modeOverrideCommitted = true;
    } catch (_error) {
      state.mode = persistedMode;
      showToast('error', t('modeSwitchFailed', { mode: t(`mode${persistedMode[0].toUpperCase()}${persistedMode.slice(1)}`) }));
    }
  }
  if (result?.meta?.focus) {
    state.focus = normalizeFocusRange(result.meta.focus);
  } else if (!state.focus?.a1) {
    setFocusFromSelection(0, 0, 0, 0, { sync: false });
  }
  invalidateCells();
  resetScrollPosition();
  if (options.seedViewport && result?.viewport) {
    mergeReadIntoCache(result.viewport);
  }
  await refreshProposal();
  await refreshViewportCells();
  await refreshHistory();
  syncFocusToHost({ force: true, broadcast: !modeOverrideCommitted });
  state.status = t(statusKey);
  render();
}

async function createWorkbook(options = {}) {
  if (state.loading || state.dialogPending) {
    setError(t('operationPending'));
    return;
  }
  if (state.modePending) {
    setError(t('modeChangePending'));
    return;
  }
  if (!state.workspacePath) {
    setError(t('noWorkspace'));
    return;
  }
  setLoading(true, t('loading'));
  try {
    const result = await callExcel('createWorkbook', {
      title: options.title || t('untitled'),
      rows: options.rows,
      cols: options.cols,
      sheetName: options.sheetName,
    });
    await adoptWorkbookResult(result, 'statusCreated', {
      seedViewport: true,
      modeOverride: 'author',
    });
  } catch (error) {
    setError(error?.message || t('createFailed'));
  } finally {
    setLoading(false);
  }
}

async function openWorkbookAtPath(filePath, options = {}) {
  if (state.loading || (state.dialogPending && options.fromDialog !== true)) {
    setError(t('operationPending'));
    return;
  }
  if (state.modePending) {
    setError(t('modeChangePending'));
    return;
  }
  if (!state.workspacePath) {
    setError(t('noWorkspace'));
    return;
  }
  if (!filePath) return;
  if (state.workbookId && samePath(state.path, filePath)) return;
  setLoading(true, t('loading'));
  try {
    const result = await callExcel('openWorkbook', { path: filePath });
    await adoptWorkbookResult(result, 'statusOpened', {
      seedViewport: true,
      sourcePath: filePath,
    });
  } catch (error) {
    setError(error?.message || t('openFailed'));
  } finally {
    setLoading(false);
  }
}

async function resumeWorkbookById(workbookId, statusKey = 'statusResumed') {
  setLoading(true, t('loading'));
  try {
    const result = await callExcel('getMeta', { workbookId });
    if (!result?.meta) return false;
    await adoptWorkbookResult(result, statusKey);
    return true;
  } catch (_error) {
    return false;
  } finally {
    setLoading(false);
  }
}

async function resumeLatestWorkbook() {
  try {
    const list = await callExcel('listWorkbooks', {});
    const newest = Array.isArray(list?.workbooks) ? list.workbooks[0] : null;
    if (!newest?.workbookId) return false;
    return await resumeWorkbookById(newest.workbookId);
  } catch (_error) {
    return false;
  }
}

async function openFile() {
  if (!beginDialogBoundary()) return;
  const host = runtime();
  if (!host.dialog?.open) {
    setError('dialog.open unavailable');
    endDialogBoundary();
    return;
  }
  try {
    const selected = await host.dialog.open({
      title: t('openDialogTitle'),
      multiple: false,
      filters: [
        { name: 'Excel', extensions: ['xlsx', 'xlsm', 'csv'] },
      ],
    });
    const path = Array.isArray(selected) ? selected[0] : selected;
    if (!path) return;
    await openWorkbookAtPath(path, { fromDialog: true });
  } catch (error) {
    setError(error?.message || t('openFailed'));
  } finally {
    endDialogBoundary();
  }
}

async function saveWorkbook() {
  if (!state.workbookId) return;
  if (!beginDialogBoundary()) return;
  try {
  const host = runtime();
  const sourcePath = state.path || state.meta?.path || null;
  if (!host.dialog?.save) {
    setError(t('exportCopyDialogMissing'));
    return;
  }
  const fidelity = state.meta?.fidelity;
  const exportPlan = exportCopyPlan(sourcePath, fidelity);
  const {
    macroEnabled,
    acknowledgeFidelityLoss,
    lossyMacroRebuild,
    extension,
  } = exportPlan;
  const fidelityPrompt = lossyMacroRebuild
    ? t('fidelityXlsmToXlsxConfirm')
    : t('fidelityExportConfirm');
  if (acknowledgeFidelityLoss && !window.confirm(fidelityPrompt)) {
    state.status = t('statusExportCancelled');
    updateChrome();
    return;
  }
  const safeTitle = String(state.meta?.title || 'workbook')
    .replace(/\.(xlsx|xlsm|csv)$/i, '')
    .replace(/[\\/:*?"<>|]+/g, '-');
  const targetPath = await host.dialog.save({
    title: t('saveDialogTitle'),
    defaultPath: `${safeTitle}-copy.${extension}`,
    filters: [{ name: extension === 'xlsm' ? t('excelMacroFile') : 'Excel', extensions: [extension] }],
  });
  if (!targetPath) return;
  if (sourcePath && samePath(sourcePath, targetPath)) {
    setError(t('exportCopySourceBlocked'));
    return;
  }
  if (!String(targetPath).toLowerCase().endsWith(`.${extension}`)) {
    setError(t(extension === 'xlsm' ? 'exportCopyMacroExtension' : 'exportCopyXlsxExtension'));
    return;
  }
  setLoading(true);
  try {
    const result = await callExcel('saveWorkbook', {
      workbookId: state.workbookId,
      path: targetPath,
      exportCopy: true,
      expectedRevision: state.meta?.revision ?? undefined,
      acknowledgeFidelityLoss,
      // The native save dialog is the explicit user confirmation boundary.
      // The engine still fingerprints an existing target and rechecks it
      // immediately before the atomic replacement.
      overwriteExisting: true,
    });
    applyMeta(result?.meta);
    // Exporting a copy must never retarget the live workbook to the new path.
    state.path = sourcePath;
    if (state.meta) state.meta = { ...state.meta, path: sourcePath };
    state.status = t('statusExportedCopy');
  } catch (error) {
    const message = String(error?.message || '');
    if (message.includes('LOSSY_XLSM_BLOCKED')) {
      setError(t('exportCopyMacroStructureBlocked'));
    } else if (message.includes('FIDELITY_ACK_REQUIRED')) {
      setError(t('exportCopyFidelityAckRequired'));
    } else {
      setError(message || t('saveFailed'));
    }
  } finally {
    setLoading(false);
  }
  } finally {
    endDialogBoundary();
  }
}

async function exportCsv() {
  if (!state.workbookId) return;
  if (!beginDialogBoundary()) return;
  try {
  const host = runtime();
  if (!host.dialog?.save) {
    setError(t('exportCopyDialogMissing'));
    return;
  }
  const acknowledgeStaleFormulaValues = staleFormulaExportRisk();
  if (acknowledgeStaleFormulaValues && !window.confirm(t('staleFormulaCsvConfirm'))) {
    state.status = t('statusExportCancelled');
    updateChrome();
    return;
  }
  const outPath = await host.dialog.save({
    title: t('exportDialogTitle'),
    defaultPath: `${state.meta?.title || 'sheet'}-copy.csv`,
    filters: [{ name: 'CSV', extensions: ['csv'] }],
  });
  if (!outPath) return;
  if (state.path && samePath(state.path, outPath)) {
    setError(t('exportCopySourceBlocked'));
    return;
  }
  setLoading(true);
  try {
    const result = await callExcel('exportCsv', {
      workbookId: state.workbookId,
      sheetId: state.activeSheetId,
      path: outPath || undefined,
      expectedRevision: state.meta?.revision ?? undefined,
      acknowledgeStaleFormulaValues,
      overwriteExisting: true,
    });
    const sanitizedCellCount = Number(
      result?.sanitizedCellCount
      ?? result?.sanitized_cell_count
      ?? result?.warning?.sanitizedCellCount
      ?? 0,
    );
    state.status = sanitizedCellCount > 0
      ? t('statusExportedSanitized', { count: sanitizedCellCount })
      : t('statusExported');
  } catch (error) {
    const message = String(error?.message || '');
    setError(
      message.includes('UNCACHED_FORMULA_CSV_BLOCKED')
        ? t('uncachedFormulaCsvBlocked')
        : message.includes('STALE_FORMULA_VALUES_ACK_REQUIRED')
        ? t('staleFormulaCsvAckRequired')
        : message || t('exportFailed'),
    );
  } finally {
    setLoading(false);
  }
  } finally {
    endDialogBoundary();
  }
}

async function switchSheet(sheetId) {
  if (!state.workbookId || !sheetId || sheetId === state.activeSheetId) return;
  if (state.loading || state.dialogPending) {
    setError(t('operationPending'));
    return;
  }
  if (state.modePending) {
    setError(t('modeChangePending'));
    return;
  }
  // Optimistic UI: switch tabs immediately, then hydrate from the engine.
  // Avoid a full-screen loading bar for a single sheet change.
  const previousSheetId = state.activeSheetId;
  setLoading(true);
  state.activeSheetId = sheetId;
  state.lastSheetTabsKey = null;
  invalidateCells();
  resetScrollPosition();
  setFocusFromSelection(0, 0, 0, 0, { sync: false });
  render();
  try {
    const result = await callExcel('switchSheet', {
      workbookId: state.workbookId,
      sheetId,
    });
    applyMeta(result?.meta);
    if (result?.viewport) mergeReadIntoCache(result.viewport);
    await refreshProposal();
    await refreshViewportCells();
    syncFocusToHost({ force: true, broadcast: true });
  } catch (error) {
    state.activeSheetId = previousSheetId;
    state.lastSheetTabsKey = null;
    setError(error?.message || t('switchFailed'));
  } finally {
    setLoading(false);
    render();
  }
}

async function addSheet() {
  if (!state.workbookId) return;
  if (writeBoundaryBlocked()) return;
  setLoading(true);
  try {
    const result = await callExcel('addSheet', {
      workbookId: state.workbookId,
      expectedRevision: state.meta?.revision ?? undefined,
    });
    applyMeta(result?.meta);
    invalidateCells();
    resetScrollPosition();
    await refreshProposal();
    await refreshViewportCells();
    await refreshHistory();
    syncFocusToHost({ force: true });
  } catch (error) {
    setError(error?.message || t('addSheetFailed'));
  } finally {
    setLoading(false);
    render();
  }
}

async function askAboutFocus() {
  const sheet = activeSheet();
  const focus = normalizeFocusRange(state.focus);
  const prompt = t('askPrompt', {
    sheet: sheet?.name || 'Sheet',
    a1: focus.a1,
    title: state.meta?.title || t('untitled'),
  });
  syncFocusToHost({ force: true });
  const host = runtime();
  if (typeof host.host?.fillChatInput === 'function') {
    await host.host.fillChatInput(prompt);
  } else if (typeof host.fillChatInput === 'function') {
    await host.fillChatInput(prompt);
  }
  state.status = t('statusAsked');
  updateChrome();
}

async function insertRow() {
  if (!state.workbookId) return;
  if (writeBoundaryBlocked()) return;
  const focus = normalizeFocusRange(state.focus);
  setLoading(true);
  try {
    const result = await callExcel('insertRows', {
      workbookId: state.workbookId,
      sheetId: state.activeSheetId,
      at: focus.r1,
      count: 1,
      expectedRevision: state.meta?.revision ?? undefined,
    });
    applyMeta(result?.meta);
    invalidateCells();
    await refreshProposal();
    await refreshViewportCells();
    await refreshHistory();
  } catch (error) {
    setError(error?.message || t('insertFailed'));
  } finally {
    setLoading(false);
  }
  render();
}

async function insertColumn() {
  if (!state.workbookId) return;
  if (writeBoundaryBlocked()) return;
  const focus = normalizeFocusRange(state.focus);
  setLoading(true);
  try {
    const result = await callExcel('insertColumns', {
      workbookId: state.workbookId,
      sheetId: state.activeSheetId,
      at: focus.c1,
      count: 1,
      expectedRevision: state.meta?.revision ?? undefined,
    });
    applyMeta(result?.meta);
    invalidateCells();
    await refreshProposal();
    await refreshViewportCells();
    await refreshHistory();
  } catch (error) {
    setError(error?.message || t('insertFailed'));
  } finally {
    setLoading(false);
  }
  render();
}

async function pinFocus() {
  try {
    await pinFocusAction();
  } catch (error) {
    setError(error?.message || String(error));
  }
  updateChrome();
}

async function acceptProposalAction() {
  const accepted = await acceptProposal();
  if (accepted) await refreshHistory();
  render();
}

async function rejectProposalAction() {
  const rejected = await rejectProposal();
  if (rejected) await refreshHistory();
  render();
}

async function jumpToProposal() {
  const proposal = state.proposal;
  if (!proposal?.a1) return;
  try {
    if (proposal.sheetId && proposal.sheetId !== state.activeSheetId) {
      await switchSheet(proposal.sheetId);
    }
    const focus = normalizeFocusRange({ a1: proposal.a1, sheetId: proposal.sheetId });
    setFocusFromSelection(focus.r1, focus.c1, focus.r2, focus.c2, {
      kind: focus.kind,
      force: true,
    });
    scrollToCell(focus.r1, focus.c1);
  } catch (_error) {
    // Ignore malformed proposal ranges.
  }
}

const MAX_CLIPBOARD_CELLS = 20000;

function encodeTsvCell(value) {
  const text = String(value ?? '');
  if (!/[\t\r\n"]/.test(text)) return text;
  return `"${text.replaceAll('"', '""')}"`;
}

function parseTsv(text) {
  const rows = [];
  let row = [];
  let value = '';
  let quoted = false;
  const source = String(text ?? '');
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (quoted) {
      if (char === '"' && source[index + 1] === '"') {
        value += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        value += char;
      }
      continue;
    }
    if (char === '"' && value === '') {
      quoted = true;
    } else if (char === '\t') {
      row.push(value);
      value = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && source[index + 1] === '\n') index += 1;
      row.push(value);
      rows.push(row);
      row = [];
      value = '';
    } else {
      value += char;
    }
  }
  row.push(value);
  rows.push(row);
  while (rows.length > 1 && rows.at(-1)?.length === 1 && rows.at(-1)?.[0] === '') {
    rows.pop();
  }
  return rows;
}

async function writeClipboardText(text) {
  const host = runtime();
  if (typeof host.clipboard?.writeText === 'function') {
    await host.clipboard.writeText(text);
    return;
  }
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  throw new Error(t('clipboardUnavailable'));
}

async function readClipboardText() {
  const host = runtime();
  if (typeof host.clipboard?.readText === 'function') {
    return host.clipboard.readText();
  }
  if (navigator.clipboard?.readText) {
    return navigator.clipboard.readText();
  }
  throw new Error(t('clipboardUnavailable'));
}

async function hydrateFocusForClipboard(focus, sheet) {
  const total = focus.rowCount * focus.columnCount;
  if (total > MAX_CLIPBOARD_CELLS) {
    throw new Error(t('clipboardRangeTooLarge', { count: MAX_CLIPBOARD_CELLS }));
  }
  let coverage = focusCacheCoverage(focus, sheet);
  if (coverage.complete) return;
  const result = await callExcel('readRange', {
    workbookId: state.workbookId,
    sheetId: sheet.id,
    a1: focus.a1,
    maxCells: total,
  });
  mergeReadIntoCache(result);
  coverage = focusCacheCoverage(focus, sheet);
  if (!coverage.complete) throw new Error(t('clipboardRangeIncomplete'));
}

async function copySelection() {
  if (!state.workbookId) return;
  if (state.loading || state.dialogPending || state.modePending) {
    setError(t(state.modePending ? 'modeChangePending' : 'operationPending'));
    return;
  }
  const sheet = activeSheet();
  if (!sheet) return;
  const focus = normalizeFocusRange(state.focus, sheet);
  setLoading(true, t('copying'));
  try {
    await hydrateFocusForClipboard(focus, sheet);
    const rows = [];
    for (let row = focus.r1; row <= focus.r2; row += 1) {
      const values = [];
      for (let col = focus.c1; col <= focus.c2; col += 1) {
        const cell = state.cells.get(cellCacheKey(sheet.id, row, col));
        values.push(encodeTsvCell(cellEditValue(cell)));
      }
      rows.push(values.join('\t'));
    }
    await writeClipboardText(rows.join('\r\n'));
    state.status = t('statusCopied', { count: focus.rowCount * focus.columnCount });
    updateChrome();
  } catch (error) {
    setError(error?.message || t('copyFailed'));
  } finally {
    setLoading(false);
  }
}

async function pasteSelection() {
  if (!state.workbookId) return;
  if (writeBoundaryBlocked()) return;
  const sheet = activeSheet();
  if (!sheet) return;
  const focus = normalizeFocusRange(state.focus, sheet);
  try {
    const text = await readClipboardText();
    if (!String(text || '').length) return;
    const values = parseTsv(text);
    const width = values.reduce((max, row) => Math.max(max, row.length), 0);
    const cellCount = values.length * width;
    if (cellCount > MAX_CLIPBOARD_CELLS) {
      throw new Error(t('clipboardRangeTooLarge', { count: MAX_CLIPBOARD_CELLS }));
    }
    const endRow = focus.r1 + values.length - 1;
    const endCol = focus.c1 + Math.max(0, width - 1);
    setLoading(true, t('pasting'));
    const result = await callExcel('applyLocalPatch', {
      workbookId: state.workbookId,
      sheetId: sheet.id,
      a1: formatA1(focus.r1, focus.c1, endRow, endCol),
      values,
      baseRevision: state.meta?.revision ?? undefined,
      expectedRevision: state.meta?.revision ?? undefined,
    });
    applyMeta(result?.meta);
    invalidateCells();
    if (result?.viewport) mergeReadIntoCache(result.viewport);
    await refreshProposal();
    await refreshViewportCells();
    await refreshHistory();
    setFocusFromSelection(focus.r1, focus.c1, endRow, endCol, { force: true });
    syncFocusToHost({ force: true, broadcast: true });
    state.status = t('statusPasted', { count: cellCount });
    render();
  } catch (error) {
    setError(error?.message || t('pasteFailed'));
  } finally {
    setLoading(false);
  }
}

async function applyHistoryAction(action, statusKey) {
  if (!state.workbookId || state.loading) return;
  if (writeBoundaryBlocked()) return;
  const allowed = action === 'undo' ? state.history.canUndo : state.history.canRedo;
  if (!allowed) return;
  setLoading(true);
  try {
    const result = await callExcel(action, {
      workbookId: state.workbookId,
      revision: state.meta?.revision ?? undefined,
      expectedRevision: state.meta?.revision ?? undefined,
    });
    applyMeta(result?.meta);
    invalidateCells();
    if (result?.viewport) mergeReadIntoCache(result.viewport);
    await refreshProposal();
    await refreshViewportCells();
    await refreshHistory();
    syncFocusToHost({ force: true, broadcast: true });
    state.status = t(statusKey);
    render();
  } catch (error) {
    setError(error?.message || t(action === 'undo' ? 'undoFailed' : 'redoFailed'));
  } finally {
    setLoading(false);
  }
}

async function undoWorkbook() {
  return applyHistoryAction('undo', 'statusUndone');
}

async function redoWorkbook() {
  return applyHistoryAction('redo', 'statusRedone');
}

async function ensureWorkbook(payload = {}) {
  if (!state.workspacePath) {
    state.bootDone = true;
    setError(t('noWorkspace'));
    render();
    return;
  }
  const launchPath =
    payload.path ||
    payload.workbookPath ||
    payload.filePath ||
    payload.launchPath ||
    payload.workbench?.path ||
    state.pendingLaunchPath ||
    null;
  state.pendingLaunchPath = null;

  try {
    if (launchPath) {
      await openWorkbookAtPath(launchPath);
      return;
    }
    if (state.workbookId) return;
    const resumed = await resumeLatestWorkbook();
    if (!resumed && !state.workbookId) {
      await createWorkbook();
    }
  } finally {
    state.bootDone = true;
    render();
  }
}

/**
 * Refresh surface state after the chat agent touched the workbook through
 * the shared Excel engine (proposals, edits, sheet or workbook changes).
 */
async function refreshFromEngine(targetWorkbookId = null) {
  if (!state.workspacePath) return;
  if (state.editing || state.editCommitPromise) {
    state.pendingAgentRefresh = { targetWorkbookId };
    return;
  }
  if (state.loading || state.dialogPending || state.modePending) {
    if (state.agentRefreshTimer) clearTimeout(state.agentRefreshTimer);
    state.agentRefreshTimer = setTimeout(() => {
      state.agentRefreshTimer = null;
      void refreshFromEngine(targetWorkbookId);
    }, 400);
    return;
  }
  setLoading(true);
  try {
    const target = typeof targetWorkbookId === 'string' ? targetWorkbookId.trim() : '';
    if (state.workbookId) {
      if (target && target !== state.workbookId) {
        return;
      }
    } else if (target) {
      await resumeWorkbookById(target, 'statusAgentUpdated');
      return;
    } else {
      // Tool completion without an explicit workbook id is not a safe basis
      // for rebinding when multiple Excel Live instances share a workspace.
      return;
    }
    const metaResult = await callExcel('getMeta', { workbookId: state.workbookId });
    applyMeta(metaResult?.meta);
    await refreshProposal();
    await refreshHistory();
    invalidateCells();
    await refreshViewportCells();
    state.status = t('statusAgentUpdated');
    render();
  } catch (_error) {
    // Agent refresh is best-effort; the next user action re-syncs anyway.
  } finally {
    setLoading(false);
  }
}

export {
  acceptProposalAction,
  addSheet,
  askAboutFocus,
  copySelection,
  createWorkbook,
  ensureWorkbook,
  exportCsv,
  insertColumn,
  insertRow,
  jumpToProposal,
  openFile,
  openWorkbookAtPath,
  pasteSelection,
  pinFocus,
  proposeSelectionFormat,
  refreshFromEngine,
  refreshHistory,
  redoWorkbook,
  rejectProposalAction,
  resumeLatestWorkbook,
  saveWorkbook,
  setError,
  setLoading,
  switchSheet,
  undoWorkbook,
};
