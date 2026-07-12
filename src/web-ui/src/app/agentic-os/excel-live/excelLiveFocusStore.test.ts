import { describe, expect, it } from 'vitest';
import {
  buildSpreadsheetFocusContext,
  isSpreadsheetFocusBoundToSession,
  spreadsheetFormulaResultsTrustworthy,
  useExcelLiveFocusStore,
} from './excelLiveFocusStore';

describe('Excel Live focus context', () => {
  it('preserves focus revision, cache evidence, mode, and capture time', () => {
    const context = buildSpreadsheetFocusContext({
      sessionId: 'session-1',
      workbookId: 'workbook-1',
      workbookPath: '/workspace/report.xlsx',
      sheetId: 'sheet-1',
      sheetName: 'Revenue',
      a1: 'B2:D4',
      selectionKind: 'range',
      rowCount: 3,
      columnCount: 3,
      mode: 'inspect',
      revision: 17,
      cacheCoverage: { cachedCellCount: 9, selectedCellCount: 9 },
      cacheComplete: true,
      formulaResultsFresh: true,
      calculationStatus: { status: 'current', formulaCount: 1 },
      fidelity: { level: 'source-preserving', canRoundTrip: true },
      capturedAt: 1_700_000_000_123,
      previewTsv: '1\t2\t3',
      valueSummary: { cellCount: 9, numericCount: 3 },
    });

    expect(context).toMatchObject({
      sessionId: 'session-1',
      workbookId: 'workbook-1',
      mode: 'inspect',
      revision: 17,
      cacheCoverage: { cachedCellCount: 9, selectedCellCount: 9 },
      cacheComplete: true,
      formulaResultsFresh: true,
      calculationStatus: { status: 'current', formulaCount: 1 },
      fidelity: { level: 'source-preserving', canRoundTrip: true },
      capturedAt: 1_700_000_000_123,
      previewTsv: '1\t2\t3',
    });
    expect(context && isSpreadsheetFocusBoundToSession(context, 'session-1')).toBe(true);
    expect(context && isSpreadsheetFocusBoundToSession(context, 'session-2')).toBe(false);
  });

  it('never forwards a preview without explicit complete-cache evidence', () => {
    const context = buildSpreadsheetFocusContext({
      sessionId: 'session-1',
      workbookId: 'workbook-1',
      sheetId: 'sheet-1',
      sheetName: 'Revenue',
      a1: 'A1:Z100',
      rowCount: 100,
      columnCount: 26,
      cacheCoverage: 0.1,
      cacheComplete: false,
      capturedAt: 1_700_000_000_123,
      previewTsv: 'cached-but-incomplete',
    });

    expect(context?.cacheComplete).toBe(false);
    expect(context?.cacheCoverage).toBe(0.1);
    expect(context?.previewTsv).toBeUndefined();
  });

  it('never forwards cached formula results marked stale', () => {
    const context = buildSpreadsheetFocusContext({
      sessionId: 'session-1',
      workbookId: 'workbook-1',
      sheetId: 'sheet-1',
      sheetName: 'Revenue',
      a1: 'E2:E4',
      rowCount: 3,
      columnCount: 1,
      cacheComplete: true,
      formulaResultsFresh: false,
      calculationStatus: { status: 'stale', formulaCount: 3 },
      previewTsv: '0.10\n0.20\n0.30',
    });

    expect(context?.cacheComplete).toBe(true);
    expect(context?.formulaResultsFresh).toBe(false);
    expect(context?.previewTsv).toBeUndefined();
  });

  it('honors an explicit stale marker even when legacy formula counts are missing', () => {
    const context = buildSpreadsheetFocusContext({
      sessionId: 'session-1',
      workbookId: 'workbook-1',
      sheetId: 'sheet-1',
      sheetName: 'Revenue',
      a1: 'A1',
      rowCount: 1,
      columnCount: 1,
      cacheComplete: true,
      formulaResultsFresh: false,
      previewTsv: '42',
    });

    expect(context?.previewTsv).toBeUndefined();
  });

  it('treats missing formula freshness as untrusted when formula evidence exists', () => {
    const context = buildSpreadsheetFocusContext({
      sessionId: 'session-1',
      workbookId: 'workbook-1',
      sheetId: 'sheet-1',
      sheetName: 'Revenue',
      a1: 'E2:E4',
      rowCount: 3,
      columnCount: 1,
      cacheComplete: true,
      calculationStatus: { status: 'cached', formulaCount: 3 },
      previewTsv: '0.10\n0.20\n0.30',
      valueSummary: {
        cellCount: 3,
        formulaCount: 3,
        numericCount: 3,
        sum: 0.6,
      },
    });

    expect(context?.previewTsv).toBeUndefined();
    expect(context?.valueSummary).toEqual({ cellCount: 3, formulaCount: 3 });
  });

  it('fails closed when formula calculation evidence is completely missing', () => {
    const context = buildSpreadsheetFocusContext({
      sessionId: 'session-unknown-formulas',
      workbookId: 'workbook-unknown-formulas',
      sheetId: 'sheet-1',
      sheetName: 'Sheet1',
      a1: 'A1:B1',
      rowCount: 1,
      columnCount: 2,
      cacheComplete: true,
      previewTsv: '10\t20',
      valueSummary: {
        cellCount: 2,
        numericCount: 2,
        formulaCount: 0,
        sum: 30,
      },
    });

    expect(context?.previewTsv).toBeUndefined();
    expect(context?.valueSummary).toEqual({ cellCount: 2, formulaCount: 0 });
    expect(context && spreadsheetFormulaResultsTrustworthy(context)).toBe(false);
  });

  it('does not let a fresh flag override cached calculation status', () => {
    expect(spreadsheetFormulaResultsTrustworthy({
      formulaResultsFresh: true,
      calculationStatus: { status: 'cached', formulaCount: 1 },
      valueSummary: { cellCount: 1, formulaCount: 0 },
    })).toBe(false);
  });

  it('keeps ambient focus isolated per chat session', () => {
    useExcelLiveFocusStore.setState({ ambient: null, ambientBySessionId: {} });
    const store = useExcelLiveFocusStore.getState();
    store.setAmbientFocus({
      sessionId: 'session-a',
      workbookId: 'workbook-a',
      sheetId: 'sheet-a',
      a1: 'A1',
    });
    useExcelLiveFocusStore.getState().setAmbientFocus({
      sessionId: 'session-b',
      workbookId: 'workbook-b',
      sheetId: 'sheet-b',
      a1: 'B2',
    });

    expect(useExcelLiveFocusStore.getState().getAmbientForSession('session-a')?.workbookId)
      .toBe('workbook-a');
    expect(useExcelLiveFocusStore.getState().getAmbientForSession('session-b')?.workbookId)
      .toBe('workbook-b');

    useExcelLiveFocusStore.getState().clearAmbientFocus('session-a');
    expect(useExcelLiveFocusStore.getState().getAmbientForSession('session-a')).toBeNull();
    expect(useExcelLiveFocusStore.getState().getAmbientForSession('session-b')?.workbookId)
      .toBe('workbook-b');
  });
});
