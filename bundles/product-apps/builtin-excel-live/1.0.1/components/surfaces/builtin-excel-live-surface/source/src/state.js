const state = {
  locale: navigator.language || 'en-US',
  route: '/sheet',
  tabId: null,
  sessionId: null,
  workspacePath: null,

  workbookId: null,
  path: null,
  meta: null,
  sheets: [],
  activeSheetId: null,

  focus: {
    sheetId: null,
    a1: 'A1',
    kind: 'cell',
    r1: 0,
    c1: 0,
    r2: 0,
    c2: 0,
  },
  proposal: null,
  proposalExpanded: false,
  proposalSelectedCellRefs: new Set(),

  history: {
    canUndo: false,
    canRedo: false,
    entries: [],
  },

  viewport: {
    scrollRow: 0,
    scrollCol: 0,
    visibleRows: 40,
    visibleCols: 16,
  },
  // Cell cache keyed `${sheetId}:${row},${col}` plus tile bookkeeping so
  // scrolling only fetches ranges we have not read yet.
  cells: new Map(),
  fetchedTiles: new Set(),
  // Canonical per-sheet presentation metadata returned by readRange/meta.
  // Kept separate from cell cache because layout applies to empty cells too.
  sheetLayouts: new Map(),

  dirty: false,
  loading: false,
  dialogPending: false,
  status: null,
  includeFocusOnSend: true,
  mode: 'edit',
  modePending: false,
  pendingMode: null,
  editing: null,
  editCommitPromise: null,
  selectionDragging: false,
  selectionAnchor: null,

  bootDone: false,
  bootChain: null,
  pendingLaunchPath: null,

  renderQueued: false,
  shellBuilt: false,
  focusSyncTimer: null,
  viewportFetchTimer: null,
  agentRefreshTimer: null,
  pendingAgentRefresh: null,
  toastTimer: null,
  lastFocusSyncKey: null,
  lastRenderedWindow: null,
  lastSheetTabsKey: null,
};

function invalidateCells() {
  state.cells.clear();
  state.fetchedTiles.clear();
  state.lastRenderedWindow = null;
}

export { state, invalidateCells };
