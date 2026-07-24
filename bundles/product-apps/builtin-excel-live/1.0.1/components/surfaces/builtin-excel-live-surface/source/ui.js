import {
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
  pasteSelection,
  pinFocus,
  proposeSelectionFormat,
  refreshFromEngine,
  refreshHistory,
  redoWorkbook,
  rejectProposalAction,
  saveWorkbook,
  switchSheet,
  undoWorkbook,
} from './src/actions.js';
import { commitModeToBackend, scheduleFocusSync, syncFocusToHost } from './src/focus.js';
import {
  clearProposalCellSelection,
  refreshProposal,
  renderProposalBar,
  selectAllProposalCells,
  toggleProposalCell,
  toggleProposalExpanded,
} from './src/proposal.js';
import { commitEdit } from './src/grid.js';
import { agentRefreshTargetsCurrentWorkbook } from './src/interaction.js';
import { t } from './src/i18n.js';
import { render } from './src/render.js';
import { state, invalidateCells } from './src/state.js';
import { closestElement, normalizePathForCompare, runtime } from './src/util.js';
import { applyStaticTexts, hideToast, showToast, updateChrome } from './src/views.js';

const AGENT_MUTATING_TOOLS = new Set([
  'propose_patch',
  'accept_proposal',
  'reject_proposal',
  'create_workbook',
  'open_workbook',
  'save_workbook',
  'switch_sheet',
  'undo_workbook',
  'redo_workbook',
  'undo',
  'redo',
  'apply_local_patch',
]);

let routeEventSeen = false;
let deferredPointerAction = null;

const EDIT_COMMIT_ACTIONS = new Set([
  'new-workbook',
  'open-workbook',
  'save-workbook',
  'export-csv',
  'pin-focus',
  'ask-focus',
  'undo',
  'redo',
  'accept-proposal',
  'reject-proposal',
  'jump-proposal',
  'toggle-proposal-details',
  'proposal-select-all',
  'proposal-select-none',
  'insert-row',
  'insert-col',
  'switch-sheet',
  'add-sheet',
  'set-mode',
  'format-role',
  'format-bold',
]);

function normalizeRoute(route) {
  const value = String(route || '/sheet').trim();
  if (!value || value === '/') return '/sheet';
  return value.startsWith('/') ? value : `/${value}`;
}

function queueBoot(payload) {
  const chain = state.bootChain || Promise.resolve();
  state.bootChain = chain
    .then(() => ensureWorkbook(payload))
    .catch(() => {});
}

function resolveWorkspacePath(payload) {
  const host = runtime();
  return (
    payload.workspacePath ||
    payload.workbench?.workspacePath ||
    state.workspacePath ||
    host.workspaceDir ||
    host.appDataDir ||
    null
  );
}

function resolveLaunchPath(payload) {
  return (
    payload.path ||
    payload.workbookPath ||
    payload.filePath ||
    payload.launchPath ||
    payload.workbench?.path ||
    null
  );
}

function handleRouteEvent(payload = {}) {
  routeEventSeen = true;
  state.route = normalizeRoute(payload.route || state.route);
  state.tabId = payload.tabId || state.tabId;
  state.sessionId = payload.sessionId || state.sessionId;

  const nextWorkspace = resolveWorkspacePath(payload);
  const workspaceChanged = Boolean(
    nextWorkspace
      && state.workspacePath
      && normalizePathForCompare(nextWorkspace) !== normalizePathForCompare(state.workspacePath),
  );
  state.workspacePath = nextWorkspace || state.workspacePath;

  let launchPath = resolveLaunchPath(payload);
  if (
    launchPath &&
    state.workbookId &&
    normalizePathForCompare(state.path) === normalizePathForCompare(launchPath)
  ) {
    launchPath = null;
  }
  if (launchPath) state.pendingLaunchPath = launchPath;

  if (workspaceChanged) {
    state.workbookId = null;
    state.path = null;
    state.meta = null;
    state.sheets = [];
    state.activeSheetId = null;
    state.proposal = null;
    invalidateCells();
    state.sheetLayouts.clear();
    state.dirty = false;
    state.bootDone = false;
    state.viewport.scrollRow = 0;
    state.viewport.scrollCol = 0;
  }

  render();

  if (state.workspacePath && (launchPath || workspaceChanged || !state.workbookId)) {
    queueBoot(payload);
  }
}

function handleActivate(payload = {}) {
  handleRouteEvent(payload || {});
}

function shortToolName(toolName) {
  const raw = String(toolName || '');
  // Host emits fully-qualified names like
  // agentcomponent__excel-live-agent__propose_patch.
  const parts = raw.split('__');
  return (parts[parts.length - 1] || raw).trim();
}

function handleAgentToolEvent(payload = {}) {
  const toolName = shortToolName(payload.toolName);
  const eventType = String(payload.eventType || '').toLowerCase();
  if (eventType !== 'completed' || !AGENT_MUTATING_TOOLS.has(toolName)) return;
  const targetWorkbookId = typeof payload.workbookId === 'string'
    ? payload.workbookId.trim()
    : '';
  // A chat session can own more than one Excel Live surface. Once a surface is
  // bound, even open/create completions for workbook B must not rebind the
  // surface already showing workbook A.
  if (!agentRefreshTargetsCurrentWorkbook(state.workbookId, targetWorkbookId)) return;
  if (state.agentRefreshTimer) clearTimeout(state.agentRefreshTimer);
  state.agentRefreshTimer = setTimeout(() => {
    state.agentRefreshTimer = null;
    void refreshFromEngine(targetWorkbookId || null);
  }, 350);
}

function modeLabel(mode) {
  if (mode === 'inspect') return t('modeInspect');
  if (mode === 'author') return t('modeAuthor');
  return t('modeEdit');
}

async function applyMode(mode) {
  const nextMode = ['inspect', 'edit', 'author'].includes(mode) ? mode : 'edit';
  if (
    !state.workbookId
    || state.loading
    || state.dialogPending
    || state.modePending
    || nextMode === state.mode
  ) return false;
  const previousMode = state.mode;
  const previousStatus = state.status;
  state.modePending = true;
  state.pendingMode = nextMode;
  state.status = t('modeSwitching', { mode: modeLabel(nextMode) });
  updateChrome();
  renderProposalBar();
  try {
    // Explicit mode changes are a confirmed execution boundary. Ambient focus
    // sync may be best-effort, but this backend write must complete before the
    // UI exposes the new permissions to either the user or AI context.
    await commitModeToBackend(nextMode);
    state.mode = nextMode;
    state.status = t('modeChanged', { mode: modeLabel(nextMode) });
    return true;
  } catch (_error) {
    state.mode = previousMode;
    state.status = previousStatus;
    showToast('error', t('modeSwitchFailed', { mode: modeLabel(previousMode) }));
    return false;
  } finally {
    state.modePending = false;
    state.pendingMode = null;
    updateChrome();
    renderProposalBar();
    // Selection can continue moving while the mode request is in flight.
    // Re-publish the latest focus after the boundary settles so host context
    // and engine focus cannot retain the pre-switch cell.
    syncFocusToHost({ force: true, broadcast: true });
  }
}

function actionDescriptor(actionNode) {
  return {
    action: actionNode?.dataset?.action || '',
    mode: actionNode?.dataset?.mode || null,
    sheetId: actionNode?.dataset?.sheetId || null,
    styleRole: actionNode?.dataset?.styleRole || null,
  };
}

function performAction(descriptor) {
  const action = descriptor.action;
  if (action === 'new-workbook') void createWorkbook();
  if (action === 'open-workbook') void openFile();
  if (action === 'save-workbook') void saveWorkbook();
  if (action === 'export-csv') void exportCsv();
  if (action === 'pin-focus') void pinFocus();
  if (action === 'ask-focus') void askAboutFocus();
  if (action === 'undo') void undoWorkbook();
  if (action === 'redo') void redoWorkbook();
  if (action === 'accept-proposal') void acceptProposalAction();
  if (action === 'reject-proposal') void rejectProposalAction();
  if (action === 'jump-proposal') void jumpToProposal();
  if (action === 'toggle-proposal-details') toggleProposalExpanded();
  if (action === 'proposal-select-all') selectAllProposalCells();
  if (action === 'proposal-select-none') clearProposalCellSelection();
  if (action === 'insert-row') void insertRow();
  if (action === 'insert-col') void insertColumn();
  if (action === 'switch-sheet') void switchSheet(descriptor.sheetId);
  if (action === 'add-sheet') void addSheet();
  if (action === 'dismiss-toast') hideToast();
  if (action === 'set-mode') void applyMode(descriptor.mode || 'edit');
  if (action === 'format-role') {
    void proposeSelectionFormat({
      styleRole: descriptor.styleRole,
      intent: t('formatRoleIntent', { role: t(`format${String(descriptor.styleRole || '').replace(/^./, (value) => value.toUpperCase())}`) }),
    });
  }
  if (action === 'format-bold') {
    void proposeSelectionFormat({ style: { font: { bold: true } }, intent: t('formatBoldIntent') });
  }
}

async function proposeFormatAfterEdit(change) {
  if (state.editing && !(await commitEdit({ exit: true }))) return;
  await proposeSelectionFormat(change);
}

async function performActionAfterEdit(descriptor) {
  if (descriptor.action === 'accept-proposal' || descriptor.action === 'reject-proposal') {
    try {
      await refreshProposal({ preserveSelection: true });
      renderProposalBar();
    } catch (error) {
      showToast('error', error?.message || t('operationPending'));
      return;
    }
  }
  performAction(descriptor);
}

function finishDeferredPointerAction(record) {
  if (deferredPointerAction !== record || !record.released || !record.settled) return;
  if (record.finishScheduled) return;
  record.finishScheduled = true;
  setTimeout(() => {
    if (deferredPointerAction !== record) return;
    deferredPointerAction = null;
    if (record.confirmed && record.committed) void performActionAfterEdit(record.descriptor);
  }, 0);
}

// Pointer activation must cross the edit boundary before the requested action.
// Otherwise blur starts an async commit, disables the pressed control, and the
// browser drops the click. A failed commit restores the draft and stops here.
document.addEventListener('pointerdown', (event) => {
  if (event.button !== 0 || !state.editing) return;
  const actionNode = closestElement(event.target, '[data-action]');
  if (!actionNode || actionNode.disabled || !EDIT_COMMIT_ACTIONS.has(actionNode.dataset.action)) return;
  const record = {
    node: actionNode,
    descriptor: actionDescriptor(actionNode),
    released: false,
    confirmed: false,
    settled: false,
    committed: false,
    finishScheduled: false,
  };
  deferredPointerAction = record;
  event.preventDefault();
  event.stopPropagation();
  void commitEdit({ exit: true }).then((committed) => {
    record.committed = committed;
    record.settled = true;
    finishDeferredPointerAction(record);
  });
}, true);

document.addEventListener('pointerup', (event) => {
  const record = deferredPointerAction;
  if (!record) return;
  const releasedNode = closestElement(event.target, '[data-action]');
  const hitNode = typeof document.elementFromPoint === 'function'
    ? closestElement(document.elementFromPoint(event.clientX, event.clientY), '[data-action]')
    : null;
  record.released = true;
  record.confirmed = releasedNode === record.node || hitNode === record.node;
  finishDeferredPointerAction(record);
}, true);

document.addEventListener('pointercancel', () => {
  const record = deferredPointerAction;
  if (!record) return;
  record.released = true;
  record.confirmed = false;
  finishDeferredPointerAction(record);
}, true);

document.addEventListener('click', (event) => {
  const actionNode = closestElement(event.target, '[data-action]');
  if (!actionNode) return;
  if (actionNode === deferredPointerAction?.node) {
    event.preventDefault();
    event.stopImmediatePropagation();
    return;
  }
  performAction(actionDescriptor(actionNode));
});

document.addEventListener('change', (event) => {
  const node = event.target;
  if (node?.dataset?.action === 'toggle-include-focus') {
    state.includeFocusOnSend = Boolean(node.checked);
    scheduleFocusSync({ force: true, immediate: true });
  }
  if (node?.dataset?.action === 'toggle-proposal-cell') {
    toggleProposalCell(node.dataset.cellRef || '', Boolean(node.checked));
  }
  if (node?.dataset?.action === 'format-fill') {
    const swatch = node.closest?.('.el-format-color')?.querySelector('span');
    if (swatch) swatch.style.borderBottomColor = node.value;
    void proposeFormatAfterEdit({
      style: { fill: { color: node.value } },
      intent: t('formatFillIntent'),
    });
  }
  if (node?.dataset?.action === 'format-number') {
    void proposeFormatAfterEdit({
      style: { numberFormat: node.value },
      intent: t('formatNumberIntent', { format: node.options?.[node.selectedIndex]?.textContent || node.value }),
    });
  }
});

document.addEventListener('excel-live:save', () => {
  void saveWorkbook();
});

document.addEventListener('excel-live:undo', () => {
  void undoWorkbook();
});

document.addEventListener('excel-live:redo', () => {
  void redoWorkbook();
});

document.addEventListener('excel-live:copy', () => {
  void copySelection();
});

document.addEventListener('excel-live:paste', () => {
  void pasteSelection();
});

document.addEventListener('excel-live:history-refresh', () => {
  void refreshHistory();
});

document.addEventListener('excel-live:proposal-render', () => {
  renderProposalBar();
});

document.addEventListener('excel-live:proposal-refresh', () => {
  void refreshProposal({ preserveSelection: true }).then(() => {
    renderProposalBar();
  });
});

document.addEventListener('excel-live:editing-settled', () => {
  const pending = state.pendingAgentRefresh;
  if (!pending) return;
  state.pendingAgentRefresh = null;
  if (state.agentRefreshTimer) clearTimeout(state.agentRefreshTimer);
  state.agentRefreshTimer = setTimeout(() => {
    state.agentRefreshTimer = null;
    void refreshFromEngine(pending.targetWorkbookId || null);
  }, 0);
});

window.addEventListener('message', (event) => {
  const message = event.data;
  if (message?.type !== 'sparo:event') return;
  if (message.event === 'localeChange') {
    state.locale = message.payload?.locale || state.locale;
    applyStaticTexts();
    state.lastSheetTabsKey = null;
    render();
  }
  if (message.event === 'productAppRuntimeRouteChange') {
    handleRouteEvent(message.payload || {});
  }
  if (message.event === 'productAppRuntimeActivate') {
    handleActivate(message.payload || {});
  }
  if (message.event === 'productAppRuntimeAgentToolEvent') {
    handleAgentToolEvent(message.payload || {});
  }
  if (message.event === 'spreadsheetFocusPreferenceChange') {
    const includeOnSend = message.payload?.includeOnSend;
    if (typeof includeOnSend === 'boolean') {
      state.includeFocusOnSend = includeOnSend;
      // Host-originated preference update: reflect it without syncing back,
      // otherwise host and iframe would form an event loop.
      updateChrome();
    }
  }
});

runtime().onLocaleChange?.((locale) => {
  state.locale = locale || state.locale;
  applyStaticTexts();
  state.lastSheetTabsKey = null;
  render();
});

runtime().onActivate?.(handleActivate);

window.addEventListener('DOMContentLoaded', () => {
  const host = runtime();
  state.locale = host.locale || state.locale;
  render();

  // The host pushes route context after load; boot from bridge-provided
  // directories only if no route event arrives (standalone preview).
  setTimeout(() => {
    if (routeEventSeen || state.bootDone || state.bootChain) return;
    handleRouteEvent({});
  }, 2500);
});
