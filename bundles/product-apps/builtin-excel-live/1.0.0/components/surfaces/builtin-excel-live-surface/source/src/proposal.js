import { callExcel } from './backend.js';
import { formatA1 } from './a1.js';
import { applyMeta } from './model.js';
import {
  layoutDifferences,
  proposalHasLayoutChanges,
  proposalValidationDetails,
  snapshotParts,
  styleDifferences,
} from './formatting.js';
import { state, invalidateCells } from './state.js';
import { t } from './i18n.js';
import { escapeHtml, rootElement } from './util.js';
import { refreshViewportCells, renderGrid } from './grid.js';
import { showToast, updateChrome } from './views.js';
import { proposalAcceptPlan } from './interaction.js';

const PROPOSAL_DETAIL_LIMIT = 300;

function proposalInteractionLocked() {
  return state.loading || state.dialogPending || state.modePending;
}

function proposalCellRef(cell, proposal = state.proposal) {
  const explicit = cell?.cellRef ?? cell?.ref ?? cell?.a1;
  if (explicit && typeof explicit === 'object') {
    const explicitA1 = explicit.a1;
    if (explicitA1 != null && String(explicitA1).trim()) return String(explicitA1).trim();
    const explicitRow = Number(explicit.row ?? explicit.r);
    const explicitCol = Number(explicit.col ?? explicit.c);
    if (Number.isInteger(explicitRow) && Number.isInteger(explicitCol)) {
      const sheetId = explicit.sheetId || cell?.sheetId || proposal?.sheetId || '';
      const a1 = formatA1(explicitRow, explicitCol);
      return sheetId ? `${sheetId}!${a1}` : a1;
    }
  }
  if (explicit != null && String(explicit).trim()) return String(explicit).trim();
  const row = Number(cell?.row ?? cell?.r);
  const col = Number(cell?.col ?? cell?.c);
  if (!Number.isInteger(row) || !Number.isInteger(col)) return '';
  const a1 = formatA1(row, col);
  const sheetId = cell?.sheetId || proposal?.sheetId || '';
  return sheetId ? `${sheetId}!${a1}` : a1;
}

function proposalCellRefs(proposal = state.proposal) {
  if (!Array.isArray(proposal?.cells)) return [];
  return proposal.cells.map((cell) => proposalCellRef(cell, proposal)).filter(Boolean);
}

function visibleProposalCellRefs(proposal = state.proposal) {
  if (!Array.isArray(proposal?.cells)) return [];
  return proposal.cells
    .slice(0, PROPOSAL_DETAIL_LIMIT)
    .map((cell) => proposalCellRef(cell, proposal))
    .filter(Boolean);
}

function hiddenProposalSelection(proposal = state.proposal) {
  if (!Array.isArray(proposal?.cells) || proposal.cells.length <= PROPOSAL_DETAIL_LIMIT) {
    return { count: 0, selected: 0 };
  }
  const hiddenRefs = proposal.cells
    .slice(PROPOSAL_DETAIL_LIMIT)
    .map((cell) => proposalCellRef(cell, proposal))
    .filter(Boolean);
  return {
    count: hiddenRefs.length,
    selected: hiddenRefs.filter((ref) => state.proposalSelectedCellRefs.has(ref)).length,
  };
}

function hiddenSelectionText(proposal = state.proposal) {
  const hidden = hiddenProposalSelection(proposal);
  if (hidden.count === 0) return '';
  if (hidden.selected === 0) return t('proposalHiddenUnselected', { count: hidden.count });
  if (hidden.selected === hidden.count) return t('proposalHiddenSelected', { count: hidden.count });
  return t('proposalHiddenPartiallySelected', {
    selected: hidden.selected,
    count: hidden.count,
  });
}

function adoptProposal(proposal, options = {}) {
  const previous = state.proposal;
  const next = proposal || null;
  const nextRefs = proposalCellRefs(next);
  const preserveSelection = Boolean(
    options.preserveSelection
    && previous?.id
    && next?.id
    && previous.id === next.id,
  );
  const selected = preserveSelection
    ? new Set(nextRefs.filter((ref) => state.proposalSelectedCellRefs.has(ref)))
    : new Set(visibleProposalCellRefs(next));

  state.proposal = next;
  state.proposalSelectedCellRefs = selected;
  if (!next) state.proposalExpanded = false;
  return next;
}

function proposalIsStale(proposal = state.proposal) {
  if (!proposal) return false;
  if (proposal.stale === true) return true;
  const baseRevision = proposal.baseRevision;
  const revision = state.meta?.revision;
  if (baseRevision == null || revision == null) return false;
  return String(baseRevision) !== String(revision);
}

function proposalIntent(proposal = state.proposal) {
  const intent = proposal?.intent;
  if (typeof intent === 'string') return intent.trim();
  if (intent && typeof intent === 'object') {
    return String(intent.summary || intent.description || intent.operation || '').trim();
  }
  return '';
}

function validationSummary(proposal = state.proposal) {
  const validation = proposal?.validation;
  if (validation == null) return null;
  if (typeof validation === 'string') {
    return { kind: 'neutral', text: validation };
  }
  if (typeof validation === 'boolean') {
    return validation
      ? { kind: 'ok', text: t('validationPassed') }
      : { kind: 'error', text: t('validationFailed') };
  }
  if (Array.isArray(validation)) {
    return validation.length
      ? { kind: 'warning', text: t('validationIssues', { count: validation.length }) }
      : { kind: 'ok', text: t('validationPassed') };
  }
  if (typeof validation === 'object') {
    const details = proposalValidationDetails(proposal);
    if (details.invalid) {
      return { kind: 'error', text: t('validationErrors', { count: details.errors.length || 1 }) };
    }
    if (details.warnings.length > 0) {
      return { kind: 'warning', text: t('validationWarnings', { count: details.warnings.length }) };
    }
    if (validation.valid === true || ['passed', 'valid', 'ok'].includes(String(validation.status || '').toLowerCase())) {
      return { kind: 'ok', text: t('validationPassed') };
    }
    if (validation.status) return { kind: 'neutral', text: String(validation.status) };
  }
  return null;
}

function snapshotDisplay(snapshot) {
  return snapshotParts(snapshot).primary || t('emptyValue');
}

function proposalValidationInvalid(proposal = state.proposal) {
  return proposalValidationDetails(proposal).invalid;
}

async function refreshProposal(options = {}) {
  if (!state.workbookId) {
    adoptProposal(null);
    return null;
  }
  const result = await callExcel('getProposal', { workbookId: state.workbookId });
  return adoptProposal(result?.proposal || null, options);
}

async function acceptProposal(cellRefs = null) {
  if (!state.workbookId || !state.proposal) return false;
  if (state.loading || state.dialogPending) {
    showToast('error', t('operationPending'));
    return false;
  }
  if (state.modePending) {
    showToast('error', t('modeChangePending'));
    return false;
  }
  if (state.mode === 'inspect') {
    showToast('error', t('inspectAcceptBlocked'));
    return false;
  }
  if (proposalIsStale()) {
    showToast('error', t('proposalStaleHint'));
    return false;
  }
  if (proposalValidationInvalid()) {
    showToast('error', t('proposalInvalidHint'));
    return false;
  }
  const selected = Array.isArray(cellRefs)
    ? cellRefs.filter(Boolean)
    : [...state.proposalSelectedCellRefs];
  const hasLayoutChanges = proposalHasLayoutChanges(state.proposal);
  const plan = proposalAcceptPlan(
    proposalCellRefs(state.proposal),
    selected,
    hasLayoutChanges,
  );
  if (!plan.layoutOnly && plan.selected.length === 0) {
    showToast('error', t('proposalSelectAtLeastOne'));
    return false;
  }

  try {
    state.loading = true;
    updateChrome();
    renderProposalBar();
    const payload = {
      workbookId: state.workbookId,
      proposalId: state.proposal.id,
      baseRevision: state.proposal.baseRevision ?? state.meta?.revision ?? undefined,
      expectedRevision: state.proposal.baseRevision ?? state.meta?.revision ?? undefined,
    };
    if (plan.payloadCellRefs) payload.cellRefs = plan.payloadCellRefs;
    const result = await callExcel('acceptProposal', payload);
    applyMeta(result?.meta);
    invalidateCells();
    // Keep the user's exclusions authoritative. After a partial accept the
    // remaining cells must not silently become selected again.
    await refreshProposal({ preserveSelection: true });
    await refreshViewportCells();
    renderGrid();
    state.status = plan.layoutOnly
      ? t('statusAcceptedLayout')
      : plan.acceptsLayout
        ? t('statusAcceptedCellsAndLayout', { count: plan.selected.length })
        : hasLayoutChanges
          ? t('statusAcceptedCellsLayoutPending', { count: plan.selected.length })
          : t('statusAcceptedCells', { count: plan.selected.length });
    return true;
  } catch (error) {
    showToast('error', error?.message || t('proposalAcceptFailed'));
    return false;
  } finally {
    state.loading = false;
    updateChrome();
    renderProposalBar();
  }
}

async function rejectProposal() {
  if (!state.workbookId || !state.proposal) return false;
  if (state.loading || state.dialogPending) {
    showToast('error', t('operationPending'));
    return false;
  }
  if (state.modePending) {
    showToast('error', t('modeChangePending'));
    return false;
  }
  try {
    state.loading = true;
    updateChrome();
    renderProposalBar();
    const result = await callExcel('rejectProposal', {
      workbookId: state.workbookId,
      proposalId: state.proposal.id,
      expectedRevision: state.meta?.revision ?? undefined,
    });
    applyMeta(result?.meta);
    adoptProposal(null);
    renderGrid();
    state.status = t('statusRejected');
    return true;
  } catch (error) {
    showToast('error', error?.message || t('proposalRejectFailed'));
    return false;
  } finally {
    state.loading = false;
    updateChrome();
    renderProposalBar();
  }
}

function toggleProposalExpanded() {
  if (proposalInteractionLocked()) return false;
  state.proposalExpanded = !state.proposalExpanded;
  renderProposalBar();
  return true;
}

function updateProposalSelectionChrome() {
  const bar = rootElement()?.querySelector('[data-proposal-bar]');
  if (!bar || !state.proposal) return;
  const count = state.proposalSelectedCellRefs.size;
  const hasLayoutChanges = proposalHasLayoutChanges(state.proposal);
  const plan = proposalAcceptPlan(proposalCellRefs(), [...state.proposalSelectedCellRefs], hasLayoutChanges);
  const selected = bar.querySelector('[data-proposal-selected-count]');
  if (selected) selected.textContent = t('proposalSelected', { count });
  const accept = bar.querySelector('[data-action="accept-proposal"]');
  if (accept) {
    accept.textContent = plan.layoutOnly
      ? t('acceptLayout')
      : plan.acceptsLayout
        ? t('acceptAllWithLayout', { count })
        : hasLayoutChanges
          ? t('acceptSelectedLayoutPending', { count })
          : t('acceptSelected', { count });
    accept.disabled = proposalInteractionLocked()
      || state.mode === 'inspect'
      || proposalIsStale()
      || proposalValidationInvalid()
      || (!plan.layoutOnly && count === 0);
  }
  bar.querySelectorAll('[data-proposal-hidden-scope]').forEach((hiddenScope) => {
    hiddenScope.textContent = hiddenSelectionText();
  });
}

function toggleProposalCell(ref, checked) {
  if (!ref || proposalInteractionLocked()) return false;
  if (checked) state.proposalSelectedCellRefs.add(ref);
  else state.proposalSelectedCellRefs.delete(ref);
  updateProposalSelectionChrome();
  return true;
}

function selectAllProposalCells() {
  if (proposalInteractionLocked()) return false;
  const refs = proposalCellRefs();
  const hiddenCount = hiddenProposalSelection().count;
  if (
    hiddenCount > 0
    && !window.confirm(t('proposalSelectAllConfirm', { count: refs.length, hidden: hiddenCount }))
  ) {
    return false;
  }
  state.proposalSelectedCellRefs = new Set(refs);
  rootElement()?.querySelectorAll('[data-action="toggle-proposal-cell"]').forEach((input) => {
    input.checked = true;
  });
  updateProposalSelectionChrome();
  return true;
}

function clearProposalCellSelection() {
  if (proposalInteractionLocked()) return false;
  state.proposalSelectedCellRefs = new Set();
  rootElement()?.querySelectorAll('[data-action="toggle-proposal-cell"]').forEach((input) => {
    input.checked = false;
  });
  updateProposalSelectionChrome();
  return true;
}

function styleValueSummary(key, value) {
  if (value == null || value === '') return t('styleNone');
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (key === 'font') {
    return [
      value.bold ? t('styleBold') : '',
      value.italic ? t('styleItalic') : '',
      value.size ? `${value.size}pt` : '',
      value.color || '',
    ].filter(Boolean).join(' · ') || t('styleNone');
  }
  if (key === 'alignment') {
    return [value.horizontal, value.vertical, value.wrapText ? t('styleWrap') : ''].filter(Boolean).join(' · ') || t('styleNone');
  }
  if (key === 'border') {
    return Object.entries(value)
      .map(([side, detail]) => `${t(`styleSide_${side}`)} ${detail?.style || ''}`.trim())
      .join(' · ') || t('styleNone');
  }
  return JSON.stringify(value);
}

function styleDiffMarkup(cell) {
  const diffs = styleDifferences(cell?.before, cell?.after);
  if (diffs.length === 0) return '';
  return `
    <div class="el-proposal-style-diff" aria-label="${escapeHtml(t('styleChanges'))}">
      ${diffs.map((diff) => {
        const label = t(`style_${diff.key}`);
        const before = styleValueSummary(diff.key, diff.before);
        const after = styleValueSummary(diff.key, diff.after);
        return `<span class="el-proposal-style-diff__item"><strong>${escapeHtml(label)}</strong> ${escapeHtml(before)} <span aria-hidden="true">→</span> ${escapeHtml(after)}</span>`;
      }).join('')}
    </div>
  `;
}

function snapshotMarkup(snapshot, kind) {
  const parts = snapshotParts(snapshot);
  const primary = parts.primary || t('emptyValue');
  return `
    <span class="el-proposal-snapshot el-proposal-snapshot--${kind}" title="${escapeHtml([primary, parts.secondary].filter(Boolean).join(' · '))}">
      <code class="el-proposal-snapshot__primary${parts.formula ? ' is-formula' : ''}">${escapeHtml(primary)}</code>
      ${parts.secondary ? `<small class="el-proposal-snapshot__cached">${escapeHtml(t('cachedValue', { value: parts.secondary }))}</small>` : ''}
    </span>
  `;
}

function validationIssuesMarkup(proposal) {
  const details = proposalValidationDetails(proposal);
  const issues = [
    ...details.errors.map((text) => ({ kind: 'error', text })),
    ...details.warnings.map((text) => ({ kind: 'warning', text })),
  ];
  if (issues.length === 0) return '';
  const visible = issues.slice(0, 8);
  return `
    <div class="el-proposal-validation-detail" role="${details.invalid ? 'alert' : 'status'}">
      <strong>${escapeHtml(t(details.invalid ? 'validationMustFix' : 'validationReview'))}</strong>
      <ul>
        ${visible.map((issue) => `<li class="is-${issue.kind}">${escapeHtml(issue.text)}</li>`).join('')}
      </ul>
      ${issues.length > visible.length ? `<span>${escapeHtml(t('validationMore', { count: issues.length - visible.length }))}</span>` : ''}
    </div>
  `;
}

function layoutValueSummary(key, value) {
  if (value == null) return t('layoutOff');
  if (key === 'freezePanes') {
    return t('layoutFreezeValue', { rows: value.rows || 0, columns: value.columns || 0 });
  }
  if (key === 'autoFilter') return value?.a1 || t('layoutOff');
  if (Array.isArray(value)) {
    if (value.length === 0) return t('layoutDefault');
    return value.map((entry) => {
      const range = entry.start === entry.end ? `${entry.start + 1}` : `${entry.start + 1}–${entry.end + 1}`;
      const workbookValue = entry.value != null
        ? `${entry.value}${entry.unit === 'points' ? 'pt' : ''}`
        : t('layoutAutoFit');
      return `${range}: ${workbookValue}`;
    }).join(', ');
  }
  return String(value);
}

function layoutDiffMarkup(proposal) {
  const diffs = layoutDifferences(proposal);
  if (diffs.length === 0) return '';
  return `
    <section class="el-proposal-layout-diff" aria-label="${escapeHtml(t('layoutChanges'))}">
      <h3>${escapeHtml(t('layoutChanges'))}</h3>
      ${diffs.map((diff) => `
        <div class="el-proposal-layout-diff__row">
          <strong>${escapeHtml(t(`layout_${diff.key}`))}</strong>
          <span>${escapeHtml(layoutValueSummary(diff.key, diff.before))}</span>
          <span aria-hidden="true">→</span>
          <span>${escapeHtml(layoutValueSummary(diff.key, diff.after))}</span>
        </div>
      `).join('')}
    </section>
  `;
}

function renderProposalDetails(proposal) {
  if (!state.proposalExpanded) return '';
  const locked = proposalInteractionLocked();
  const disabled = locked ? ' disabled' : '';
  const cells = Array.isArray(proposal.cells) ? proposal.cells : [];
  const visible = cells.slice(0, PROPOSAL_DETAIL_LIMIT);
  const rows = visible.map((cell) => {
    const ref = proposalCellRef(cell, proposal);
    const checked = state.proposalSelectedCellRefs.has(ref);
    const row = Number(cell.row ?? cell.r);
    const col = Number(cell.col ?? cell.c);
    const location = cell.a1 || (
      Number.isInteger(row) && Number.isInteger(col) ? formatA1(row, col) : ref
    );
    const before = snapshotDisplay(cell.before);
    const after = snapshotDisplay(cell.after);
    return `
      <label class="el-proposal-detail__row" role="row">
        <span role="cell" class="el-proposal-detail__check">
          <input type="checkbox" data-action="toggle-proposal-cell" data-cell-ref="${escapeHtml(ref)}" ${checked ? 'checked' : ''}${disabled} />
        </span>
        <span role="cell" class="el-proposal-detail__ref">${escapeHtml(location)}</span>
        <span role="cell" class="el-proposal-detail__before" title="${escapeHtml(before)}">${snapshotMarkup(cell.before, 'before')}</span>
        <span role="cell" class="el-proposal-detail__after" title="${escapeHtml(after)}">${snapshotMarkup(cell.after, 'after')}${styleDiffMarkup(cell)}</span>
      </label>
    `;
  }).join('');
  const remainder = Math.max(0, cells.length - visible.length);
  const hiddenText = hiddenSelectionText(proposal);
  const cellDetails = cells.length > 0 ? `
      <div class="el-proposal-detail__toolbar">
        <span data-proposal-selected-count>${t('proposalSelected', { count: state.proposalSelectedCellRefs.size })}</span>
        <button type="button" class="el-link-btn" data-action="proposal-select-all"${disabled}>${t('selectAllCount', { count: cells.length })}</button>
        <button type="button" class="el-link-btn" data-action="proposal-select-none"${disabled}>${t('selectNone')}</button>
      </div>
      <div class="el-proposal-detail__table" role="table" aria-label="${escapeHtml(t('proposalDetails'))}">
        <div class="el-proposal-detail__head" role="row">
          <span role="columnheader"></span>
          <span role="columnheader">${t('cell')}</span>
          <span role="columnheader">${t('before')}</span>
          <span role="columnheader">${t('after')}</span>
        </div>
        ${rows}
      </div>
      ${remainder > 0 ? `<p class="el-proposal-detail__limit" data-proposal-hidden-scope>${escapeHtml(hiddenText)}</p>` : ''}
  ` : '';
  return `
    <div class="el-proposal-detail">
      ${cellDetails}
      ${layoutDiffMarkup(proposal)}
    </div>
  `;
}

function renderProposalBar() {
  const bar = rootElement()?.querySelector('[data-proposal-bar]');
  if (!bar) return;
  if (!state.proposal) {
    bar.hidden = true;
    bar.innerHTML = '';
    return;
  }
  const proposal = state.proposal;
  const count = Array.isArray(proposal.cells)
    ? proposal.cells.length
    : proposal.cellCount || 0;
  const range = proposal.a1
    ? `${proposal.sheetName ? `${proposal.sheetName}!` : ''}${proposal.a1}`
    : proposal.sheetName || t('layoutChanges');
  const stale = proposalIsStale(proposal);
  const validation = validationSummary(proposal);
  const intent = proposalIntent(proposal);
  const selectedCount = state.proposalSelectedCellRefs.size;
  const hasLayoutChanges = proposalHasLayoutChanges(proposal);
  const acceptPlan = proposalAcceptPlan(proposalCellRefs(proposal), [...state.proposalSelectedCellRefs], hasLayoutChanges);
  const layoutOnly = acceptPlan.layoutOnly;
  const hiddenText = hiddenSelectionText(proposal);
  const locked = proposalInteractionLocked();
  const validationInvalid = proposalValidationInvalid(proposal);
  const acceptDisabled = locked
    || state.mode === 'inspect'
    || stale
    || validationInvalid
    || (!layoutOnly && selectedCount === 0);
  const rejectDisabled = locked;
  bar.hidden = false;
  bar.dataset.stale = stale ? 'true' : 'false';
  bar.innerHTML = `
    <div class="el-proposal__summary">
      <div class="el-proposal__main">
        <span class="el-proposal__badge">${t('proposalTitle')}</span>
        ${intent ? `<span class="el-proposal__intent">${escapeHtml(intent)}</span>` : ''}
        <button type="button" class="el-proposal__range" data-action="jump-proposal" title="${escapeHtml(t('proposalHint'))}" ${locked ? 'disabled' : ''}>${escapeHtml(range)}</button>
        <span class="el-proposal__meta">${layoutOnly ? t('proposalLayoutChange') : t('proposalCells', { count })}</span>
        ${hiddenText ? `<span class="el-proposal__hidden-scope" data-proposal-hidden-scope>${escapeHtml(hiddenText)}</span>` : ''}
        ${validation ? `<span class="el-proposal__validation is-${validation.kind}">${escapeHtml(validation.text)}</span>` : ''}
        ${stale ? `<span class="el-proposal__stale" role="alert">${t('proposalStale')}</span>` : ''}
      </div>
      <div class="el-proposal__actions">
        <button type="button" class="el-btn el-btn--ghost" data-action="toggle-proposal-details" aria-expanded="${state.proposalExpanded}" ${locked ? 'disabled' : ''}>${state.proposalExpanded ? t('hideDetails') : t('reviewDetails')}</button>
        <button type="button" class="el-btn el-btn--accept" data-action="accept-proposal" ${acceptDisabled ? 'disabled' : ''}>${layoutOnly
    ? t('acceptLayout')
    : acceptPlan.acceptsLayout
      ? t('acceptAllWithLayout', { count: selectedCount })
      : hasLayoutChanges
        ? t('acceptSelectedLayoutPending', { count: selectedCount })
        : t('acceptSelected', { count: selectedCount })}</button>
        <button type="button" class="el-btn el-btn--ghost" data-action="reject-proposal" ${rejectDisabled ? 'disabled' : ''}>${t('rejectProposal')}</button>
      </div>
    </div>
    ${stale ? `<p class="el-proposal__stale-hint">${t('proposalStaleHint')}</p>` : ''}
    ${hasLayoutChanges && !layoutOnly ? `<p class="el-proposal__layout-hint">${t(acceptPlan.acceptsLayout ? 'proposalLayoutAllHint' : 'proposalLayoutPartialHint')}</p>` : ''}
    ${validationIssuesMarkup(proposal)}
    ${validationInvalid ? `<p class="el-proposal__invalid-hint">${t('proposalInvalidHint')}</p>` : ''}
    ${renderProposalDetails(proposal)}
  `;
}

export {
  acceptProposal,
  adoptProposal,
  clearProposalCellSelection,
  proposalCellRef,
  proposalCellRefs,
  proposalIsStale,
  refreshProposal,
  rejectProposal,
  renderProposalBar,
  selectAllProposalCells,
  toggleProposalCell,
  toggleProposalExpanded,
};
