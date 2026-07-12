import assert from 'node:assert/strict';
import test from 'node:test';

import {
  agentRefreshTargetsCurrentWorkbook,
  buildSelectionStyleCells,
  createEditingDraft,
  editingExpectedRevision,
  exportCopyPlan,
  gridSelectionNeedsEditCommit,
  isComposingKey,
  isSaveShortcut,
  proposalAcceptPlan,
} from '../src/interaction.js';
import {
  LIVE_VIEW_SEMANTICS,
  axisIndexAtOffset,
  axisOffset,
  excelColumnWidthToPixels,
  excelRowHeightToPixels,
  formatValueWithNumberFormat,
  layoutDifferences,
  normalizeCellStyle,
  normalizeSheetLayout,
  proposalHasLayoutChanges,
  proposalValidationDetails,
  snapshotParts,
  styleDifferences,
  styleToCss,
} from '../src/formatting.js';

test('focus fidelity declares the rendered values, formulas, styles, and layout semantics', () => {
  assert.equal(LIVE_VIEW_SEMANTICS, 'values-formulas-styles-layout');
});

test('an existing surface ignores agent refreshes for another workbook', () => {
  assert.equal(agentRefreshTargetsCurrentWorkbook('workbook-a', 'workbook-b'), false);
  assert.equal(agentRefreshTargetsCurrentWorkbook('workbook-a', 'workbook-a'), true);
  assert.equal(agentRefreshTargetsCurrentWorkbook(null, 'workbook-b'), true);
});

test('an editing draft keeps the revision from when editing started', () => {
  const draft = createEditingDraft({
    row: 2,
    col: 4,
    value: '=SUM(A1:A2)',
    workbookId: 'workbook-a',
    sheetId: 'sheet-a',
    revision: 7,
    origin: 'formula',
  });

  assert.equal(draft.baseRevision, 7);
  assert.equal(draft.origin, 'formula');
  assert.equal(editingExpectedRevision(draft, 11), 7);
});

test('IME Enter is not treated as an edit command and save works inside inputs', () => {
  assert.equal(isComposingKey({ key: 'Enter', isComposing: true }), true);
  assert.equal(isComposingKey({ key: 'Enter', keyCode: 229 }), true);
  assert.equal(isComposingKey({ key: 'Enter', isComposing: false }), false);
  assert.equal(isSaveShortcut({ key: 's', ctrlKey: true }), true);
  assert.equal(isSaveShortcut({ key: 'S', metaKey: true }), true);
  assert.equal(isSaveShortcut({ key: 's' }), false);
});

test('grid selection waits for an edit commit only when leaving the edited cell', () => {
  const editing = createEditingDraft({
    row: 1,
    col: 2,
    value: 'draft',
    workbookId: 'workbook-a',
    sheetId: 'sheet-a',
    revision: 3,
  });

  assert.equal(gridSelectionNeedsEditCommit(null, { row: 2, col: 2, sheetId: 'sheet-a' }), false);
  assert.equal(gridSelectionNeedsEditCommit(editing, { row: 1, col: 2, sheetId: 'sheet-a' }), false);
  assert.equal(gridSelectionNeedsEditCommit(editing, { row: 2, col: 2, sheetId: 'sheet-a' }), true);
  assert.equal(gridSelectionNeedsEditCommit(editing, { row: 1, col: 2, sheetId: 'sheet-b' }), true);
});

test('cell styles normalize semantic roles and Excel alignment/font units for CSS', () => {
  const title = normalizeCellStyle({ role: 'title', alignment: { vertical: 'center' } });
  const warning = normalizeCellStyle({ role: 'warning' });

  assert.equal(title.role, 'title');
  assert.equal(title.fill.color, '#17365D');
  assert.equal(title.font.size, 14);
  assert.equal(title.alignment.vertical, 'middle');
  assert.equal(warning.font.color, '#C00000');
  assert.match(styleToCss({ role: 'title' }), /font-size:18\.67px/);
});

test('proposal snapshots keep formulas visible beside cached values and expose style changes', () => {
  const before = { f: 'SUM(A1:A3)', v: 42, style: { fill: { color: '#FFFFFF' } } };
  const after = { f: 'SUM(A1:A4)', v: 42, style: { fill: { color: '#DDEBF7' }, font: { bold: true } } };
  const parts = snapshotParts(after);

  assert.equal(parts.primary, '=SUM(A1:A4)');
  assert.equal(parts.secondary, '42');
  assert.deepEqual(styleDifferences(before, after).map((item) => item.key), ['fill', 'font']);
});

test('validation errors including formula lint fail closed', () => {
  const details = proposalValidationDetails({
    validation: {
      status: 'warning',
      warnings: ['Overwrites one cell'],
      formulaLint: {
        errors: [{ code: 'FORMULA_PARSE', message: 'Formula syntax is invalid' }],
      },
    },
  });

  assert.equal(details.invalid, true);
  assert.deepEqual(details.errors, ['Formula syntax is invalid']);
  assert.deepEqual(details.warnings, ['Overwrites one cell']);
});

test('layout metadata converts Excel units to pixels and supports layout-only proposals', () => {
  assert.equal(excelColumnWidthToPixels(16), 117);
  assert.equal(excelRowHeightToPixels(18), 24);
  const layout = normalizeSheetLayout({
    units: { columnWidth: 'excelCharacters', rowHeight: 'points' },
    columns: [{ start: 0, end: 0, width: 16 }],
    rows: [{ start: 0, end: 0, height: 18 }],
    freezePanes: { rows: 1, columns: 1 },
    autoFilter: { a1: 'A1:D20' },
  });
  assert.equal(layout.columns[0].size, 117);
  assert.equal(layout.rows[0].size, 24);
  assert.equal(axisOffset(2, layout.columns, 100, 140), 217);
  assert.equal(axisIndexAtOffset(118, 10, layout.columns, 100, 140), 1);

  const proposal = { layout: { before: null, after: { freezePanes: { rows: 1 }, autoFilter: { a1: 'A1:D20' } } } };
  assert.equal(proposalHasLayoutChanges(proposal), true);
  assert.deepEqual(layoutDifferences(proposal).map((item) => item.key), ['freezePanes', 'autoFilter']);
});

test('format controls build reviewable style-only proposal cells without changing values', () => {
  const cells = buildSelectionStyleCells(
    { r1: 1, c1: 2, r2: 2, c2: 3 },
    { style: { numberFormat: '0.00%' } },
  );
  assert.equal(cells.length, 4);
  assert.deepEqual(cells[0], { row: 1, col: 2, style: { numberFormat: '0.00%' } });
  assert.equal(Object.hasOwn(cells[0], 'value'), false);
  assert.throws(
    () => buildSelectionStyleCells({ r1: 0, c1: 0, r2: 100, c2: 100 }, { styleRole: 'header' }, 5000),
    RangeError,
  );
});

test('common number formats render percentages, dates, and grouped numbers', () => {
  assert.equal(formatValueWithNumberFormat(0.125, '0.00%'), '12.50%');
  assert.equal(formatValueWithNumberFormat(45292, 'yyyy-mm-dd'), '2024-01-01');
  assert.equal(formatValueWithNumberFormat(1, 'yyyy-mm-dd'), '1900-01-01');
  assert.equal(formatValueWithNumberFormat(59, 'yyyy-mm-dd'), '1900-02-28');
  assert.equal(formatValueWithNumberFormat(60, 'yyyy-mm-dd'), '1900-02-29');
  assert.equal(formatValueWithNumberFormat(61, 'yyyy-mm-dd'), '1900-03-01');
  assert.match(formatValueWithNumberFormat(1234.5, '#,##0.00'), /1[,.]234[,.]50/);
});

test('mixed cell and layout proposals become atomic only when every cell is selected', () => {
  const partial = proposalAcceptPlan(['A1', 'A2'], ['A1'], true);
  assert.deepEqual(partial.payloadCellRefs, ['A1']);
  assert.equal(partial.acceptsLayout, false);

  const complete = proposalAcceptPlan(['A1', 'A2'], ['A2', 'A1'], true);
  assert.equal(complete.payloadCellRefs, null);
  assert.equal(complete.acceptsLayout, true);

  const layoutOnly = proposalAcceptPlan([], [], true);
  assert.equal(layoutOnly.layoutOnly, true);
  assert.equal(layoutOnly.payloadCellRefs, null);
});

test('lossy macro workbooks export through an explicit xlsx copy path', () => {
  const sourcePreserving = exportCopyPlan('models/report.xlsm', { canRoundTrip: true });
  assert.equal(sourcePreserving.extension, 'xlsm');
  assert.equal(sourcePreserving.lossyMacroRebuild, false);

  const lossy = exportCopyPlan('models/report.xlsm', { canRoundTrip: false });
  assert.equal(lossy.extension, 'xlsx');
  assert.equal(lossy.acknowledgeFidelityLoss, true);
  assert.equal(lossy.lossyMacroRebuild, true);

  const standard = exportCopyPlan('models/report.xlsx', { canRoundTrip: false });
  assert.equal(standard.extension, 'xlsx');
  assert.equal(standard.acknowledgeFidelityLoss, true);
});
