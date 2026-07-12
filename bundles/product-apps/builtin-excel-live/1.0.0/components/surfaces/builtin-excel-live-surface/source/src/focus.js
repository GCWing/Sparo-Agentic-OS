import { callExcel } from './backend.js';
import { formatA1 } from './a1.js';
import { buildFocusPayload, normalizeFocusRange } from './model.js';
import { state } from './state.js';
import { runtime } from './util.js';
import { t } from './i18n.js';

const FOCUS_HOST_DEBOUNCE_MS = 120;
const FOCUS_BACKEND_DEBOUNCE_MS = 900;

function focusSyncKey(payload) {
  return [
    payload.workbookId || '',
    payload.sheetId || '',
    payload.a1 || '',
    payload.selectionKind || '',
    payload.role || 'ambient',
    payload.includeFocusOnSend ? '1' : '0',
    payload.mode || 'edit',
    payload.revision ?? '',
    payload.cacheComplete ? '1' : '0',
    payload.cacheCoverage ?? 0,
    payload.previewTsv || '',
  ].join('|');
}

async function broadcastFocusToBackend() {
  if (!state.workbookId || !state.workspacePath) return;
  if (state.modePending) return;
  // Skip while the user is still dragging a selection — each bridge call
  // currently spawns a Node process and would freeze the grid.
  if (state.selectionDragging) return;
  const focus = normalizeFocusRange(state.focus);
  try {
    await callExcel('setFocus', {
      workbookId: state.workbookId,
      sheetId: focus.sheetId,
      a1: focus.a1,
      kind: focus.kind,
      mode: state.mode,
      revision: state.meta?.revision ?? null,
    });
  } catch (_error) {
    // Ambient focus sync is best-effort; UI selection still works without it.
  }
}

async function commitModeToBackend(mode) {
  if (!state.workbookId || !state.workspacePath) {
    throw new Error(t('modeUnavailable'));
  }
  if (!['inspect', 'edit', 'author'].includes(mode)) {
    throw new Error(t('modeUnavailable'));
  }
  // A queued ambient sync may still carry the previous mode. Cancel it before
  // committing this explicit execution boundary so it cannot race and undo the
  // user's choice after the confirmed write returns.
  if (state.focusSyncTimer) {
    clearTimeout(state.focusSyncTimer);
    state.focusSyncTimer = null;
  }
  const focus = normalizeFocusRange(state.focus);
  return callExcel('setFocus', {
    workbookId: state.workbookId,
    sheetId: focus.sheetId,
    a1: focus.a1,
    kind: focus.kind,
    mode,
    revision: state.meta?.revision ?? null,
  });
}

function syncFocusToHost(options = {}) {
  const role = options.role || 'ambient';
  const payload = buildFocusPayload(role);
  const key = focusSyncKey(payload);
  if (!options.force && key === state.lastFocusSyncKey && role === 'ambient') {
    return payload;
  }
  state.lastFocusSyncKey = key;

  const host = runtime();
  if (typeof host.host?.syncSpreadsheetFocus === 'function') {
    void host.host.syncSpreadsheetFocus(payload);
  } else if (typeof host.syncSpreadsheetFocus === 'function') {
    void host.syncSpreadsheetFocus(payload);
  }

  // Host ambient context is cheap; backend setFocus is expensive. Default to
  // host-only sync for selection changes and only push to the engine when
  // explicitly requested (pin / ask / settled selection).
  if (options.broadcast === true) {
    void broadcastFocusToBackend();
  }
  return payload;
}

function scheduleFocusSync(options = {}) {
  if (state.focusSyncTimer) {
    clearTimeout(state.focusSyncTimer);
  }
  const delay = options.immediate
    ? 0
    : (options.broadcast === true ? FOCUS_BACKEND_DEBOUNCE_MS : FOCUS_HOST_DEBOUNCE_MS);
  state.focusSyncTimer = setTimeout(() => {
    state.focusSyncTimer = null;
    // Default: host-only ambient sync. Backend setFocus is expensive (fresh
    // Node process per call) and is reserved for settled selection / pin.
    syncFocusToHost(options);
  }, delay);
}

function setFocusFromSelection(r1, c1, r2 = r1, c2 = c1, options = {}) {
  const next = normalizeFocusRange({
    sheetId: state.activeSheetId,
    r1,
    c1,
    r2,
    c2,
    kind: options.kind || (r1 === r2 && c1 === c2 ? 'cell' : 'range'),
  });
  state.focus = next;
  if (options.sync !== false) {
    scheduleFocusSync({ force: Boolean(options.force) });
  }
  return next;
}

async function pinFocus() {
  const payload = syncFocusToHost({ role: 'pinned', force: true, broadcast: true });
  const host = runtime();
  const marker = t('pinMarker', {
    sheet: payload.sheetName || 'Sheet',
    a1: payload.a1,
  });

  if (typeof host.host?.addContext === 'function') {
    await host.host.addContext({
      ...payload,
      role: 'pinned',
      label: `${payload.sheetName || 'Sheet'}!${payload.a1}`,
    });
  } else if (typeof host.addContext === 'function') {
    await host.addContext({
      ...payload,
      role: 'pinned',
      label: `${payload.sheetName || 'Sheet'}!${payload.a1}`,
    });
  } else if (typeof host.host?.fillChatInput === 'function') {
    await host.host.fillChatInput(marker);
  } else if (typeof host.fillChatInput === 'function') {
    await host.fillChatInput(marker);
  }

  state.status = t('statusPinned');
  return payload;
}

function activeCellA1() {
  const focus = normalizeFocusRange(state.focus);
  return formatA1(focus.r1, focus.c1);
}

export {
  activeCellA1,
  commitModeToBackend,
  pinFocus,
  scheduleFocusSync,
  setFocusFromSelection,
  syncFocusToHost,
};
