import { renderGrid } from './grid.js';
import { renderProposalBar } from './proposal.js';
import { state } from './state.js';
import { ensureShell, updateChrome } from './views.js';

/**
 * Coalesced render: build the shell once, then apply targeted updates.
 * The grid keeps its own scroll position and DOM identity across renders.
 */
function render() {
  if (state.renderQueued) return;
  state.renderQueued = true;
  queueMicrotask(() => {
    state.renderQueued = false;
    const root = ensureShell();
    if (!root) return;
    updateChrome();
    renderProposalBar();
    if (state.workbookId) {
      renderGrid();
    }
  });
}

export { render };
