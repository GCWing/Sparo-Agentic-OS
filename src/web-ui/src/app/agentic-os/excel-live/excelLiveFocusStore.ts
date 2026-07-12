import { create } from 'zustand';
import type {
  SpreadsheetFocusCacheCoverage,
  SpreadsheetFocusContext,
  SpreadsheetFocusMode,
} from '@/shared/types/context';

export interface SpreadsheetFocusPayload {
  sessionId?: string;
  workbookId?: string;
  workbookPath?: string;
  sheetId?: string;
  sheetName?: string;
  a1?: string;
  selectionKind?: SpreadsheetFocusContext['selectionKind'];
  rowCount?: number;
  columnCount?: number;
  mode?: SpreadsheetFocusMode;
  revision?: string | number;
  cacheCoverage?: SpreadsheetFocusCacheCoverage;
  cacheComplete?: boolean;
  formulaResultsFresh?: boolean;
  calculationStatus?: Record<string, unknown>;
  fidelity?: Record<string, unknown>;
  capturedAt?: number;
  previewTsv?: string;
  previewTruncated?: boolean;
  valueSummary?: SpreadsheetFocusContext['valueSummary'];
  role?: 'ambient' | 'pinned';
  includeOnSend?: boolean;
  includeFocusOnSend?: boolean;
  label?: string;
}

interface ExcelLiveFocusState {
  ambient: SpreadsheetFocusContext | null;
  ambientBySessionId: Record<string, SpreadsheetFocusContext>;
  includeOnSend: boolean;
  setAmbientFocus: (payload: SpreadsheetFocusPayload | null) => void;
  setIncludeOnSend: (include: boolean) => void;
  clearAmbientFocus: (sessionId?: string) => void;
  getAmbientForSession: (sessionId: string | null | undefined) => SpreadsheetFocusContext | null;
  toContextItem: (role?: 'ambient' | 'pinned', sessionId?: string) => SpreadsheetFocusContext | null;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function normalizeMode(value: unknown): SpreadsheetFocusMode | undefined {
  return value === 'inspect' || value === 'edit' || value === 'author'
    ? value
    : undefined;
}

function normalizeRevision(value: unknown): string | number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  return optionalString(value);
}

function normalizeCacheCoverage(value: unknown): SpreadsheetFocusCacheCoverage | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return { ...(value as Record<string, unknown>) };
  }
  return undefined;
}

function normalizeCapturedAt(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : fallback;
}

function normalizeRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? { ...(value as Record<string, unknown>) }
    : undefined;
}

function calculationStatusIsExplicitlyFresh(status: Record<string, unknown> | undefined): boolean {
  const token = String(status?.status ?? status?.state ?? '').trim().toLowerCase();
  return token === 'current'
    || token === 'fresh'
    || token === 'ready'
    || token === 'calculated'
    || token === 'recalculated'
    || token === 'ok'
    || token === 'not-required';
}

function calculationStatusIsExplicitlyUntrusted(status: Record<string, unknown> | undefined): boolean {
  const token = String(status?.status ?? status?.state ?? '').trim().toLowerCase();
  return token === 'cached'
    || token === 'stale'
    || token === 'pending'
    || token === 'dirty'
    || token === 'unknown'
    || token === 'failed'
    || token === 'error';
}

export function spreadsheetFormulaResultsTrustworthy(context: Pick<
  SpreadsheetFocusPayload,
  'formulaResultsFresh' | 'calculationStatus' | 'valueSummary'
>): boolean {
  if (context.formulaResultsFresh === false) return false;
  if (calculationStatusIsExplicitlyUntrusted(context.calculationStatus)) return false;
  if (calculationStatusIsExplicitlyFresh(context.calculationStatus)) return true;
  // A surface may explicitly attest freshness, but absence of both freshness
  // and calculation evidence is never proof that formulas do not exist.
  return context.formulaResultsFresh === true;
}

function trustworthyValueSummary(
  valueSummary: SpreadsheetFocusPayload['valueSummary'],
  formulaTrustworthy: boolean,
): SpreadsheetFocusPayload['valueSummary'] {
  if (!valueSummary || formulaTrustworthy) {
    return valueSummary;
  }
  return {
    cellCount: valueSummary.cellCount,
    ...(valueSummary.formulaCount == null ? {} : { formulaCount: valueSummary.formulaCount }),
  };
}

function buildContext(
  payload: SpreadsheetFocusPayload,
  role: 'ambient' | 'pinned',
): SpreadsheetFocusContext | null {
  const workbookId = typeof payload.workbookId === 'string' ? payload.workbookId.trim() : '';
  const sheetId = typeof payload.sheetId === 'string' ? payload.sheetId.trim() : '';
  const sheetName = typeof payload.sheetName === 'string' ? payload.sheetName.trim() : sheetId;
  const a1 = typeof payload.a1 === 'string' ? payload.a1.trim() : '';
  if (!workbookId || !sheetId || !a1) return null;

  const selectionKind = payload.selectionKind || 'range';
  const rowCount = Math.max(0, Number(payload.rowCount) || 0);
  const columnCount = Math.max(0, Number(payload.columnCount) || 0);
  const timestamp = Date.now();
  const capturedAt = normalizeCapturedAt(payload.capturedAt, timestamp);
  const sessionId = optionalString(payload.sessionId);
  const workbookPath = optionalString(payload.workbookPath);
  const mode = normalizeMode(payload.mode);
  const revision = normalizeRevision(payload.revision);
  const cacheCoverage = normalizeCacheCoverage(payload.cacheCoverage);
  const formulaResultsFresh = typeof payload.formulaResultsFresh === 'boolean'
    ? payload.formulaResultsFresh
    : undefined;
  const calculationStatus = normalizeRecord(payload.calculationStatus);
  const fidelity = normalizeRecord(payload.fidelity);
  const formulaTrustworthy = spreadsheetFormulaResultsTrustworthy({
    formulaResultsFresh,
    calculationStatus,
    valueSummary: payload.valueSummary,
  });
  // A preview built from only the viewport cache can silently turn unknown
  // cells into empty cells. Only forward it when the surface explicitly
  // proves that its cache covers the entire selected range.
  const cacheComplete = payload.cacheComplete === true;
  const previewTsv = cacheComplete
    && formulaTrustworthy
    && typeof payload.previewTsv === 'string'
    ? payload.previewTsv
    : undefined;

  return {
    id: role === 'pinned'
      ? `spreadsheet-focus-pinned-${workbookId}-${sheetId}-${a1}-${timestamp}`
      : `spreadsheet-focus-ambient-${sessionId || 'unbound'}-${workbookId}`,
    timestamp,
    type: 'spreadsheet-focus',
    schemaVersion: 1,
    role,
    sessionId,
    workbookId,
    workbookPath,
    sheetId,
    sheetName: sheetName || sheetId,
    a1,
    selectionKind,
    rowCount,
    columnCount,
    mode,
    revision,
    cacheCoverage,
    cacheComplete,
    formulaResultsFresh,
    calculationStatus,
    fidelity,
    capturedAt,
    previewTsv,
    previewTruncated: Boolean(payload.previewTruncated),
    valueSummary: trustworthyValueSummary(payload.valueSummary, formulaTrustworthy),
    metadata: {
      source: 'excel-live-focus',
      binding: {
        sessionId: sessionId ?? null,
        workbookId,
      },
      snapshot: {
        mode: mode ?? null,
        revision: revision ?? null,
        cacheCoverage: cacheCoverage ?? null,
        cacheComplete,
        formulaResultsFresh: formulaResultsFresh ?? null,
        calculationStatus: calculationStatus ?? null,
        fidelity: fidelity ?? null,
        capturedAt,
        previewIncluded: Boolean(previewTsv),
      },
    },
  };
}

export const useExcelLiveFocusStore = create<ExcelLiveFocusState>((set, get) => ({
  ambient: null,
  ambientBySessionId: {},
  includeOnSend: true,

  setAmbientFocus: (payload) => {
    if (!payload) {
      set({ ambient: null, ambientBySessionId: {} });
      return;
    }
    const next = buildContext(payload, 'ambient');
    const includeOnSend = payload.includeOnSend !== false && payload.includeFocusOnSend !== false;
    set((state) => {
      const bindingSessionId = next?.sessionId;
      const current = bindingSessionId
        ? state.ambientBySessionId[bindingSessionId] ?? null
        : state.ambient;
      const sameBinding = Boolean(
        current
        && next
        && current.sessionId === next.sessionId
        && current.workbookId === next.workbookId,
      );
      // Ignore delayed focus events from an older selection. The include
      // toggle is still accepted because it is a separate user preference.
      if (sameBinding && next && current && next.capturedAt < current.capturedAt) {
        return { includeOnSend };
      }
      const ambientBySessionId = bindingSessionId && next
        ? { ...state.ambientBySessionId, [bindingSessionId]: next }
        : state.ambientBySessionId;
      return {
        ambient: next,
        ambientBySessionId,
        includeOnSend,
      };
    });
  },

  setIncludeOnSend: (include) => set({ includeOnSend: include }),

  clearAmbientFocus: (sessionId) => set((state) => {
    if (!sessionId) return { ambient: null, ambientBySessionId: {} };
    if (!(sessionId in state.ambientBySessionId)) return state;
    const ambientBySessionId = { ...state.ambientBySessionId };
    delete ambientBySessionId[sessionId];
    return {
      ambient: state.ambient?.sessionId === sessionId ? null : state.ambient,
      ambientBySessionId,
    };
  }),

  getAmbientForSession: (sessionId) => (
    sessionId ? get().ambientBySessionId[sessionId] ?? null : null
  ),

  toContextItem: (role = 'ambient', sessionId) => {
    const ambient = sessionId
      ? get().ambientBySessionId[sessionId] ?? null
      : get().ambient;
    if (!ambient) return null;
    if (role === 'ambient') return ambient;
    return {
      ...ambient,
      id: `spreadsheet-focus-pinned-${ambient.workbookId}-${ambient.sheetId}-${ambient.a1}-${Date.now()}`,
      role: 'pinned',
      timestamp: Date.now(),
    };
  },
}));

export function buildSpreadsheetFocusContext(
  payload: SpreadsheetFocusPayload,
  role: 'ambient' | 'pinned' = 'ambient',
): SpreadsheetFocusContext | null {
  return buildContext(payload, role);
}

export function isSpreadsheetFocusBoundToSession(
  context: SpreadsheetFocusContext,
  sessionId: string | null | undefined,
): boolean {
  return Boolean(sessionId && context.sessionId && context.sessionId === sessionId);
}

export function spreadsheetFocusMetadata(context: SpreadsheetFocusContext): Record<string, unknown> {
  const capturedAt = Number.isFinite(context.capturedAt) && context.capturedAt > 0
    ? context.capturedAt
    : context.timestamp;
  return {
    schemaVersion: context.schemaVersion,
    role: context.role,
    sessionId: context.sessionId ?? null,
    workbookId: context.workbookId,
    workbookPath: context.workbookPath ?? null,
    sheetId: context.sheetId,
    sheetName: context.sheetName,
    a1: context.a1,
    selectionKind: context.selectionKind,
    rowCount: context.rowCount,
    columnCount: context.columnCount,
    mode: context.mode ?? null,
    revision: context.revision ?? null,
    cacheCoverage: context.cacheCoverage ?? null,
    cacheComplete: context.cacheComplete === true,
    formulaResultsFresh: context.formulaResultsFresh ?? null,
    calculationStatus: context.calculationStatus ?? null,
    fidelity: context.fidelity ?? null,
    capturedAt,
    previewIncluded: context.cacheComplete === true && Boolean(context.previewTsv),
  };
}
