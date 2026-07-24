import { escapeHtml, rootElement } from './util.js';
import { t } from './i18n.js';
import { state } from './state.js';
import { proposalHasLayoutChanges, proposalValidationDetails } from './formatting.js';
import {
  activeSheet,
  calculationStatusIsFresh,
  normalizeFocusRange,
  selectionValueSummary,
} from './model.js';

const ICONS = {
  logo: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><rect x="1.5" y="1.5" width="13" height="13" rx="2"/><path d="M1.5 6h13M6.5 1.5v13"/></svg>',
  newWorkbook: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="2" width="12" height="12" rx="2"/><path d="M8 5.5v5M5.5 8h5"/></svg>',
  open: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M1.8 4.2c0-.7.5-1.2 1.2-1.2h3l1.5 1.8h5.7c.7 0 1.2.5 1.2 1.2v6c0 .7-.5 1.2-1.2 1.2H3c-.7 0-1.2-.5-1.2-1.2v-7.8z"/></svg>',
  save: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 2h8.5L14 4.5V13a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1z"/><path d="M5 2v3.5h5.5V2M5 14v-4.5h6V14"/></svg>',
  exportCopy: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><rect x="5" y="4" width="8" height="9" rx="1.5"/><path d="M3 11H2.5A1.5 1.5 0 0 1 1 9.5v-7A1.5 1.5 0 0 1 2.5 1h6A1.5 1.5 0 0 1 10 2.5V4"/></svg>',
  export: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M8 2v8M5 7.2 8 10.2l3-3M2.5 12.5h11"/></svg>',
  undo: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M6 4 2.5 7.5 6 11"/><path d="M3 7.5h6.2a3.8 3.8 0 0 1 0 7.6H8"/></svg>',
  redo: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="m10 4 3.5 3.5L10 11"/><path d="M13 7.5H6.8a3.8 3.8 0 0 0 0 7.6H8"/></svg>',
  insertRow: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M2 3h12M2 13h12"/><path d="M8 6v4M6 8h4"/></svg>',
  insertCol: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 2v12M13 2v12"/><path d="M8 6v4M6 8h4"/></svg>',
  pin: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M6 2h4l.5 4.5 2 1.5v1.5H3.5V8l2-1.5L6 2z"/><path d="M8 9.5V14"/></svg>',
  spark: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M8 1.8 9.3 5.6 13 7 9.3 8.4 8 12.2 6.7 8.4 3 7l3.7-1.4L8 1.8z"/><path d="M12.8 11.2l.5 1.5 1.5.5-1.5.5-.5 1.5-.5-1.5-1.5-.5 1.5-.5.5-1.5z"/></svg>',
  add: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M8 3.5v9M3.5 8h9"/></svg>',
  empty: '<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="6" y="8" width="36" height="32" rx="3"/><path d="M6 16h36M6 24h36M6 32h36M18 16v24M30 16v24"/></svg>',
};

function iconButton(action, icon, labelKey, extraClass = '') {
  return `<button type="button" class="el-icon-btn ${extraClass}" data-action="${action}" data-label-key="${labelKey}" aria-label="" title="">${ICONS[icon]}</button>`;
}

function ensureShell() {
  const root = rootElement();
  if (!root) return null;
  if (state.shellBuilt && root.dataset.shell === 'ready') return root;

  root.className = 'excel-live';
  root.dataset.shell = 'ready';
  root.innerHTML = `
    <header class="el-toolbar">
      <div class="el-toolbar__brand">
        <span class="el-logo">${ICONS.logo}</span>
        <strong class="el-title" data-title></strong>
        <span class="el-spin" data-loading-spin hidden></span>
      </div>
      <div class="el-toolbar__actions">
        ${iconButton('new-workbook', 'newWorkbook', 'newWorkbook')}
        ${iconButton('open-workbook', 'open', 'openWorkbook')}
        ${iconButton('save-workbook', 'exportCopy', 'save')}
        ${iconButton('export-csv', 'export', 'exportCsv')}
        <span class="el-sep"></span>
        ${iconButton('undo', 'undo', 'undo')}
        ${iconButton('redo', 'redo', 'redo')}
        <span class="el-sep"></span>
        ${iconButton('insert-row', 'insertRow', 'insertRow')}
        ${iconButton('insert-col', 'insertCol', 'insertCol')}
      </div>
      <div class="el-toolbar__right">
        <div class="el-mode" data-mode-group role="group">
          <button type="button" class="el-mode__btn" data-action="set-mode" data-mode="inspect" data-label-key="modeInspect"></button>
          <button type="button" class="el-mode__btn" data-action="set-mode" data-mode="edit" data-label-key="modeEdit"></button>
          <button type="button" class="el-mode__btn" data-action="set-mode" data-mode="author" data-label-key="modeAuthor"></button>
        </div>
        <span class="el-mode__hint" data-mode-hint role="status" aria-live="polite"></span>
        <span class="el-sep"></span>
        ${iconButton('pin-focus', 'pin', 'pinFocus')}
        <button type="button" class="el-btn el-btn--accent el-ask" data-action="ask-focus">
          ${ICONS.spark}<span data-ask-label></span>
        </button>
      </div>
    </header>

    <section class="el-formatbar" aria-label="" data-formatbar>
      <span class="el-formatbar__label" data-text-key="formatStyles"></span>
      <div class="el-formatbar__presets" role="group">
        <button type="button" class="el-format-preset is-header" data-action="format-role" data-style-role="header" data-format-control data-text-key="formatHeader"></button>
        <button type="button" class="el-format-preset is-total" data-action="format-role" data-style-role="total" data-format-control data-text-key="formatTotal"></button>
        <button type="button" class="el-format-preset is-input" data-action="format-role" data-style-role="input" data-format-control data-text-key="formatInput"></button>
        <button type="button" class="el-format-preset is-output" data-action="format-role" data-style-role="output" data-format-control data-text-key="formatOutput"></button>
      </div>
      <span class="el-sep"></span>
      <button type="button" class="el-format-btn el-format-btn--bold" data-action="format-bold" data-format-control data-label-key="formatBold" aria-label="" title="">B</button>
      <label class="el-format-color" data-label-key="formatFill" title="">
        <span aria-hidden="true"></span>
        <input type="color" value="#FFF2CC" data-action="format-fill" data-format-control aria-label="" />
      </label>
      <label class="el-format-number">
        <span class="el-sr-only" data-text-key="numberFormat"></span>
        <select data-action="format-number" data-format-control aria-label="">
          <option value="General" data-text-key="numberGeneral"></option>
          <option value="#,##0" data-text-key="numberInteger"></option>
          <option value="#,##0.00" data-text-key="numberDecimal"></option>
          <option value="$#,##0.00" data-text-key="numberCurrency"></option>
          <option value="0.00%" data-text-key="numberPercent"></option>
          <option value="yyyy-mm-dd" data-text-key="numberDate"></option>
        </select>
      </label>
      <span class="el-formatbar__hint" data-format-hint></span>
    </section>

    <section class="el-formulabar">
      <input class="el-namebox" data-namebox type="text" spellcheck="false" autocomplete="off" />
      <span class="el-fx-label" aria-hidden="true">fx</span>
      <input class="el-fx-input" data-formula-input type="text" spellcheck="false" autocomplete="off" />
      <label class="el-include" data-include-label>
        <input type="checkbox" data-action="toggle-include-focus" />
        <span data-include-text></span>
      </label>
    </section>

    <section class="el-trust" data-trust-banner role="status" aria-live="polite" hidden></section>

    <section class="el-proposal" data-proposal-bar aria-live="polite" aria-atomic="false" hidden></section>

    <section class="el-grid-wrap" data-grid-wrap role="grid" aria-label="" tabindex="0">
      <div class="el-loadbar" data-loading-bar aria-hidden="true" hidden></div>
      <div class="el-grid__scroll" data-grid-scroll hidden>
        <div class="el-grid__pin">
          <div class="el-grid__corner" data-grid-corner></div>
          <div class="el-grid__col-headers" data-col-headers role="row" aria-rowindex="1"></div>
        </div>
        <div class="el-grid__under">
          <div class="el-grid__row-headers" data-row-headers></div>
          <div class="el-grid__body" data-grid-body>
            <div class="el-grid__cells" data-grid-cells></div>
            <div class="el-sel" data-selection-box hidden></div>
            <div class="el-sel-active" data-active-box hidden></div>
            <div class="el-grid__editor" data-cell-editor hidden>
              <input type="text" spellcheck="false" autocomplete="off" />
            </div>
          </div>
        </div>
      </div>
      <div class="el-empty" data-empty-state hidden>
        <div class="el-empty__icon">${ICONS.empty}</div>
        <h2 data-empty-title></h2>
        <p data-empty-hint></p>
        <div class="el-empty__actions">
          <button type="button" class="el-btn el-btn--accent" data-action="new-workbook" data-empty-new></button>
          <button type="button" class="el-btn" data-action="open-workbook" data-empty-open></button>
        </div>
      </div>
      <div class="el-boot" data-boot-state>
        <div class="el-loader"></div>
        <p data-boot-text></p>
      </div>
      <div class="el-sr-only" data-active-grid-row role="row"><div id="el-grid-active-cell" data-active-gridcell role="gridcell" aria-selected="true"></div></div>
      <div class="el-sr-only" data-grid-announcer role="status" aria-live="polite"></div>
      <button type="button" class="el-toast" data-toast data-action="dismiss-toast" aria-live="polite" aria-atomic="true" hidden></button>
    </section>

    <footer class="el-bottombar">
      <div class="el-sheets" data-sheet-tabs role="tablist"></div>
      <button type="button" class="el-add-sheet" data-action="add-sheet" data-label-key="addSheet" aria-label="" title="">${ICONS.add}</button>
      <div class="el-bottombar__spacer"></div>
      <div class="el-stats" data-selection-stats role="status" aria-live="polite"></div>
      <div class="el-statustext" data-status-text role="status" aria-live="polite"></div>
    </footer>
  `;

  state.shellBuilt = true;
  applyStaticTexts(root);
  return root;
}

function applyStaticTexts(root = rootElement()) {
  if (!root) return;
  root.querySelectorAll('[data-label-key]').forEach((node) => {
    const label = t(node.dataset.labelKey);
    node.setAttribute('aria-label', label);
    node.setAttribute('title', label);
    if (node.classList.contains('el-mode__btn')) {
      node.textContent = label;
    }
  });
  root.querySelectorAll('[data-text-key]').forEach((node) => {
    node.textContent = t(node.dataset.textKey);
  });
  const formatbar = root.querySelector('[data-formatbar]');
  if (formatbar) formatbar.setAttribute('aria-label', t('formatStyles'));
  const formatPresets = root.querySelector('.el-formatbar__presets');
  if (formatPresets) formatPresets.setAttribute('aria-label', t('formatStyles'));
  const fillInput = root.querySelector('[data-action="format-fill"]');
  if (fillInput) fillInput.setAttribute('aria-label', t('formatFill'));
  const numberSelect = root.querySelector('[data-action="format-number"]');
  if (numberSelect) numberSelect.setAttribute('aria-label', t('numberFormat'));
  root.querySelectorAll('[data-mode-group] .el-mode__btn').forEach((node) => {
    const mode = node.dataset.mode || 'edit';
    const hintKey = mode === 'inspect'
      ? 'modeInspectHint'
      : mode === 'author'
        ? 'modeAuthorHint'
        : 'modeEditHint';
    node.setAttribute('title', t(hintKey));
    node.setAttribute('aria-label', `${node.textContent}: ${t(hintKey)}`);
  });
  const askLabel = root.querySelector('[data-ask-label]');
  if (askLabel) askLabel.textContent = t('askFocus');
  const askBtn = root.querySelector('[data-action="ask-focus"]');
  if (askBtn) askBtn.setAttribute('title', t('askFocus'));
  const includeText = root.querySelector('[data-include-text]');
  if (includeText) includeText.textContent = t('includeFocus');
  const includeLabel = root.querySelector('[data-include-label]');
  if (includeLabel) includeLabel.setAttribute('title', t('includeFocusTitle'));
  const namebox = root.querySelector('[data-namebox]');
  if (namebox) namebox.setAttribute('title', t('nameBoxTitle'));
  const fxInput = root.querySelector('[data-formula-input]');
  if (fxInput) fxInput.setAttribute('title', t('formulaTitle'));
  const emptyTitle = root.querySelector('[data-empty-title]');
  if (emptyTitle) emptyTitle.textContent = t('emptyTitle');
  const emptyHint = root.querySelector('[data-empty-hint]');
  if (emptyHint) emptyHint.textContent = t('emptyHint');
  const emptyNew = root.querySelector('[data-empty-new]');
  if (emptyNew) emptyNew.textContent = t('newWorkbook');
  const emptyOpen = root.querySelector('[data-empty-open]');
  if (emptyOpen) emptyOpen.textContent = t('openWorkbook');
  const bootText = root.querySelector('[data-boot-text]');
  if (bootText) bootText.textContent = t('boot');
  const sheetTabs = root.querySelector('[data-sheet-tabs]');
  if (sheetTabs) sheetTabs.setAttribute('aria-label', t('sheetTabs'));
  const grid = root.querySelector('[data-grid-wrap]');
  if (grid) grid.setAttribute('aria-label', t('gridLabel'));
}

function statusToken(value) {
  if (typeof value === 'string') return value.trim().toLowerCase().replaceAll('_', '-');
  if (!value || typeof value !== 'object') return '';
  return String(value.status || value.state || value.kind || value.level || '')
    .trim()
    .toLowerCase()
    .replaceAll('_', '-');
}

function renderTrustBanner(root = rootElement()) {
  const banner = root?.querySelector('[data-trust-banner]');
  if (!banner) return;
  if (!state.workbookId) {
    banner.hidden = true;
    banner.innerHTML = '';
    return;
  }

  const messages = [];
  let kind = 'warning';
  const fidelity = state.meta?.fidelity;
  const fidelityToken = statusToken(fidelity);
  const sourcePreserving = fidelityToken === 'source-preserving';
  const fullFidelity = [
    'full',
    'exact',
    'preserved',
    'high',
    'native',
  ].includes(fidelityToken);
  if (sourcePreserving) {
    messages.push(t('fidelitySourcePreservingView'));
  } else if (fidelity != null && !fullFidelity) {
    const explicit = fidelity && typeof fidelity === 'object' && typeof fidelity.message === 'string'
      ? fidelity.message.trim()
      : '';
    messages.push(explicit || t(
      ['limited', 'basic', 'partial', 'degraded', 'values-formulas-only'].includes(fidelityToken)
        ? 'fidelityLimited'
        : 'fidelityUnknown',
    ));
  }

  const calculation = state.meta?.calculationStatus;
  const calculationToken = statusToken(calculation);
  const calculationCurrent = [
    'current',
    'ready',
    'calculated',
    'recalculated',
    'ok',
    'not-required',
  ].includes(calculationToken);
  if (calculation != null && !calculationCurrent) {
    const explicit = calculation && typeof calculation === 'object' && typeof calculation.message === 'string'
      ? calculation.message.trim()
      : '';
    let key = 'calculationUnknown';
    if (['pending', 'stale', 'cached', 'not-calculated', 'unrecalculated', 'dirty'].includes(calculationToken)) {
      key = 'calculationPending';
    }
    if (['failed', 'error'].includes(calculationToken)) {
      key = 'calculationFailed';
      kind = 'error';
    }
    messages.push(explicit || t(key));
  }

  if (messages.length === 0) {
    banner.hidden = true;
    banner.innerHTML = '';
    return;
  }
  banner.hidden = false;
  banner.dataset.kind = kind;
  banner.innerHTML = messages
    .map((message) => `<span>${escapeHtml(message)}</span>`)
    .join('<span class="el-trust__sep" aria-hidden="true">·</span>');
}

function updateChrome() {
  const root = rootElement();
  if (!root || !state.shellBuilt) return;

  const hasWorkbook = Boolean(state.workbookId);
  const readOnly = state.mode === 'inspect';
  const boundaryPending = state.modePending;
  const busy = state.loading || state.dialogPending || boundaryPending;
  root.setAttribute('aria-busy', busy ? 'true' : 'false');

  const title = root.querySelector('[data-title]');
  if (title) title.textContent = state.meta?.title || t('title');

  const spin = root.querySelector('[data-loading-spin]');
  if (spin) spin.hidden = !busy;
  const loadbar = root.querySelector('[data-loading-bar]');
  if (loadbar) loadbar.hidden = !busy;
  const grid = root.querySelector('[data-grid-wrap]');
  if (grid) grid.setAttribute('aria-busy', busy ? 'true' : 'false');

  for (const action of ['save-workbook', 'export-csv', 'pin-focus', 'ask-focus']) {
    const btn = root.querySelector(`[data-action="${action}"]:not([data-empty-new]):not([data-empty-open])`);
    if (btn) btn.disabled = !hasWorkbook || busy;
  }
  root.querySelectorAll('[data-action="new-workbook"], [data-action="open-workbook"]')
    .forEach((btn) => { btn.disabled = busy; });
  for (const action of ['insert-row', 'insert-col']) {
    const btn = root.querySelector(`[data-action="${action}"]`);
    if (btn) btn.disabled = !hasWorkbook || busy || readOnly;
  }
  root.querySelectorAll('[data-format-control]').forEach((control) => {
    control.disabled = !hasWorkbook || busy || readOnly || Boolean(state.proposal);
  });
  const formatHint = root.querySelector('[data-format-hint]');
  if (formatHint) {
    formatHint.textContent = state.proposal ? t('formatProposalExistsShort') : '';
  }
  const undo = root.querySelector('[data-action="undo"]');
  if (undo) undo.disabled = !hasWorkbook || busy || readOnly || !state.history.canUndo;
  const redo = root.querySelector('[data-action="redo"]');
  if (redo) redo.disabled = !hasWorkbook || busy || readOnly || !state.history.canRedo;
  const addSheet = root.querySelector('[data-action="add-sheet"]');
  if (addSheet) addSheet.disabled = !hasWorkbook || busy || readOnly;

  root.querySelectorAll('[data-mode-group] .el-mode__btn').forEach((btn) => {
    btn.classList.toggle('is-active', btn.dataset.mode === state.mode);
    btn.setAttribute('aria-pressed', btn.dataset.mode === state.mode ? 'true' : 'false');
    btn.disabled = !hasWorkbook || busy;
  });
  root.dataset.mode = state.mode;
  const modeHint = root.querySelector('[data-mode-hint]');
  if (modeHint) {
    modeHint.textContent = t(
      state.mode === 'inspect'
        ? 'modeInspectHint'
        : state.mode === 'author'
          ? 'modeAuthorHint'
          : 'modeEditHint',
    );
  }

  const fxInput = root.querySelector('[data-formula-input]');
  if (fxInput) {
    fxInput.disabled = !hasWorkbook || busy;
    fxInput.readOnly = readOnly || busy;
    fxInput.placeholder = state.mode === 'inspect' ? t('readOnly') : '';
  }
  const namebox = root.querySelector('[data-namebox]');
  if (namebox) namebox.disabled = !hasWorkbook || busy;

  const cellEditorInput = root.querySelector('[data-cell-editor] input');
  if (cellEditorInput) cellEditorInput.disabled = !hasWorkbook || busy || readOnly;

  const includeCheckbox = root.querySelector('[data-action="toggle-include-focus"]');
  if (includeCheckbox) {
    includeCheckbox.checked = Boolean(state.includeFocusOnSend);
    includeCheckbox.disabled = busy;
  }

  root.querySelectorAll([
    '[data-action="jump-proposal"]',
    '[data-action="toggle-proposal-details"]',
    '[data-action="proposal-select-all"]',
    '[data-action="proposal-select-none"]',
    '[data-action="toggle-proposal-cell"]',
  ].join(',')).forEach((control) => {
    control.disabled = busy;
  });
  const proposalStale = Boolean(
    state.proposal?.stale === true
    || (
      state.proposal?.baseRevision != null
      && state.meta?.revision != null
      && String(state.proposal.baseRevision) !== String(state.meta.revision)
    ),
  );
  const acceptProposal = root.querySelector('[data-action="accept-proposal"]');
  if (acceptProposal) {
    const proposalCellCount = Array.isArray(state.proposal?.cells) ? state.proposal.cells.length : 0;
    const layoutOnly = proposalCellCount === 0 && proposalHasLayoutChanges(state.proposal);
    acceptProposal.disabled = busy
      || readOnly
      || proposalStale
      || proposalValidationDetails(state.proposal).invalid
      || (!layoutOnly && state.proposalSelectedCellRefs.size === 0);
  }
  const rejectProposal = root.querySelector('[data-action="reject-proposal"]');
  if (rejectProposal) rejectProposal.disabled = busy;

  const scroll = root.querySelector('[data-grid-scroll]');
  const empty = root.querySelector('[data-empty-state]');
  const boot = root.querySelector('[data-boot-state]');
  const booting = !state.bootDone && !hasWorkbook;
  if (scroll) scroll.hidden = !hasWorkbook;
  if (empty) empty.hidden = hasWorkbook || booting;
  if (boot) boot.hidden = !booting;

  const statusText = root.querySelector('[data-status-text]');
  if (statusText) statusText.textContent = state.status || '';

  renderTrustBanner(root);
  updateSelectionStats(root);
  renderSheetTabs(root);
}

function updateSelectionStats(root = rootElement()) {
  const node = root?.querySelector('[data-selection-stats]');
  if (!node) return;
  if (!state.workbookId) {
    node.textContent = '';
    return;
  }
  const focus = normalizeFocusRange(state.focus);
  const summary = selectionValueSummary(focus);
  if (!summary || summary.cellCount <= 1) {
    node.textContent = '';
    return;
  }
  if (summary.formulaCount > 0 && !calculationStatusIsFresh()) {
    node.textContent = t('statsFormulaStale');
    return;
  }
  if (summary.numericCount === 0) {
    node.textContent = '';
    return;
  }
  const parts = [
    `${t('statsCount')} ${summary.numericCount}`,
    `${t('statsSum')} ${formatNumber(summary.sum)}`,
  ];
  if (summary.avg != null) {
    parts.push(`${t('statsAvg')} ${formatNumber(summary.avg)}`);
  }
  node.textContent = parts.join('  ·  ');
}

function formatNumber(value) {
  if (!Number.isFinite(value)) return String(value);
  const rounded = Math.round(value * 10000) / 10000;
  return String(rounded);
}

function renderSheetTabs(root = rootElement()) {
  const host = root?.querySelector('[data-sheet-tabs]');
  if (!host) return;
  const busy = state.loading || state.dialogPending || state.modePending;
  const key = `${(state.sheets || []).map((s) => `${s.id}:${s.name}`).join('|')}#${state.activeSheetId}#${busy ? 'busy' : 'ready'}`;
  if (key === state.lastSheetTabsKey) return;
  state.lastSheetTabsKey = key;
  host.innerHTML = (state.sheets || [])
    .map((sheet) => {
      const active = sheet.id === state.activeSheetId;
      return `<button type="button" role="tab" aria-selected="${active}" class="el-sheet-tab${active ? ' is-active' : ''}" data-action="switch-sheet" data-sheet-id="${escapeHtml(sheet.id)}"${busy ? ' disabled' : ''}>${escapeHtml(sheet.name)}</button>`;
    })
    .join('');
}

function showToast(kind, message) {
  const toast = rootElement()?.querySelector('[data-toast]');
  if (!toast) return;
  toast.hidden = false;
  toast.textContent = message;
  toast.dataset.kind = kind;
  toast.setAttribute('aria-live', kind === 'error' ? 'assertive' : 'polite');
  if (state.toastTimer) clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => {
    state.toastTimer = null;
    hideToast();
  }, kind === 'error' ? 8000 : 4000);
}

function hideToast() {
  const toast = rootElement()?.querySelector('[data-toast]');
  if (toast) toast.hidden = true;
  if (state.toastTimer) {
    clearTimeout(state.toastTimer);
    state.toastTimer = null;
  }
}

export {
  applyStaticTexts,
  ensureShell,
  hideToast,
  renderSheetTabs,
  showToast,
  updateChrome,
  updateSelectionStats,
};
