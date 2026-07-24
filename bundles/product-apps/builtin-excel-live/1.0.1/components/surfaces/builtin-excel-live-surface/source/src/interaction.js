function normalizeWorkbookId(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function agentRefreshTargetsCurrentWorkbook(currentWorkbookId, targetWorkbookId) {
  const current = normalizeWorkbookId(currentWorkbookId);
  const target = normalizeWorkbookId(targetWorkbookId);
  return !current || !target || current === target;
}

function createEditingDraft({
  row,
  col,
  value,
  workbookId,
  sheetId,
  revision,
  origin = 'cell',
}) {
  return {
    row,
    col,
    value: String(value ?? ''),
    workbookId: normalizeWorkbookId(workbookId) || null,
    sheetId: normalizeWorkbookId(sheetId) || null,
    baseRevision: revision ?? null,
    origin: origin === 'formula' ? 'formula' : 'cell',
  };
}

function editingExpectedRevision(editing, fallbackRevision) {
  return editing?.baseRevision ?? fallbackRevision;
}

function isComposingKey(event) {
  return Boolean(event?.isComposing || event?.keyCode === 229);
}

function isSaveShortcut(event) {
  return Boolean(
    event
    && (event.ctrlKey || event.metaKey)
    && String(event.key || '').toLowerCase() === 's',
  );
}

function gridSelectionNeedsEditCommit(editing, targetCell) {
  if (!editing || !targetCell) return false;
  if (!Number.isInteger(targetCell.row) || !Number.isInteger(targetCell.col)) return false;
  const targetSheetId = normalizeWorkbookId(targetCell.sheetId);
  const editingSheetId = normalizeWorkbookId(editing.sheetId);
  return editing.row !== targetCell.row
    || editing.col !== targetCell.col
    || Boolean(targetSheetId && editingSheetId && targetSheetId !== editingSheetId);
}

function buildSelectionStyleCells(focus, change = {}, maxCells = 5000) {
  const r1 = Number(focus?.r1);
  const c1 = Number(focus?.c1);
  const r2 = Number(focus?.r2 ?? focus?.r1);
  const c2 = Number(focus?.c2 ?? focus?.c1);
  if (![r1, c1, r2, c2].every(Number.isInteger)) return [];
  const rowStart = Math.min(r1, r2);
  const rowEnd = Math.max(r1, r2);
  const colStart = Math.min(c1, c2);
  const colEnd = Math.max(c1, c2);
  const count = (rowEnd - rowStart + 1) * (colEnd - colStart + 1);
  if (count > maxCells) throw new RangeError(`Formatting selection exceeds ${maxCells} cells`);
  const styleRole = String(change.styleRole || '').trim() || null;
  const style = change.style && typeof change.style === 'object' ? change.style : null;
  if (!styleRole && !style) return [];
  const cells = [];
  for (let row = rowStart; row <= rowEnd; row += 1) {
    for (let col = colStart; col <= colEnd; col += 1) {
      cells.push({
        row,
        col,
        ...(styleRole ? { styleRole } : {}),
        ...(style ? { style } : {}),
      });
    }
  }
  return cells;
}

function proposalAcceptPlan(allCellRefs, selectedCellRefs, hasLayoutChanges) {
  const all = [...new Set((allCellRefs || []).filter(Boolean))];
  const selectedSet = new Set((selectedCellRefs || []).filter((ref) => all.includes(ref)));
  const selected = all.filter((ref) => selectedSet.has(ref));
  const layoutOnly = hasLayoutChanges && all.length === 0;
  const allCellsSelected = all.length > 0 && selected.length === all.length;
  const acceptsLayout = Boolean(hasLayoutChanges && (layoutOnly || allCellsSelected));
  return {
    all,
    selected,
    layoutOnly,
    allCellsSelected,
    acceptsLayout,
    // The Engine interprets omitted cellRefs as whole-proposal acceptance,
    // which is the only atomic path that applies layout alongside cells.
    payloadCellRefs: acceptsLayout ? null : selected,
  };
}

function exportCopyPlan(sourcePath, fidelity) {
  const source = String(sourcePath || '').trim().toLowerCase();
  const macroEnabled = source.endsWith('.xlsm');
  const excelSource = source.endsWith('.xlsx') || macroEnabled;
  const canRoundTrip = fidelity && typeof fidelity === 'object'
    ? fidelity.canRoundTrip ?? fidelity.can_round_trip
    : undefined;
  const acknowledgeFidelityLoss = Boolean(excelSource && canRoundTrip === false);
  const lossyMacroRebuild = macroEnabled && acknowledgeFidelityLoss;
  return {
    macroEnabled,
    excelSource,
    canRoundTrip,
    acknowledgeFidelityLoss,
    lossyMacroRebuild,
    extension: macroEnabled && !lossyMacroRebuild ? 'xlsm' : 'xlsx',
  };
}

export {
  agentRefreshTargetsCurrentWorkbook,
  buildSelectionStyleCells,
  createEditingDraft,
  editingExpectedRevision,
  exportCopyPlan,
  gridSelectionNeedsEditCommit,
  isComposingKey,
  isSaveShortcut,
  proposalAcceptPlan,
};
