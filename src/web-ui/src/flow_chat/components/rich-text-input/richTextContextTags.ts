import type { ContextItem } from '../../../shared/types/context';
import { spreadsheetFormulaResultsTrustworthy } from '@/app/agentic-os/excel-live/excelLiveFocusStore';

function spreadsheetFocusDisplayName(context: Extract<ContextItem, { type: 'spreadsheet-focus' }>): string {
  const mode = context.mode
    ? `${context.mode.slice(0, 1).toUpperCase()}${context.mode.slice(1)}`
    : 'Mode unknown';
  const cache = context.cacheComplete ? '' : ' · partial cache';
  const formulas = spreadsheetFormulaResultsTrustworthy(context) ? '' : ' · stale/unknown formulas';
  return `${context.sheetName}!${context.a1} · ${mode}${cache}${formulas}`;
}

function spreadsheetCoverageLabel(context: Extract<ContextItem, { type: 'spreadsheet-focus' }>): string {
  const coverage = context.cacheCoverage;
  if (coverage == null) return 'unknown';
  if (typeof coverage === 'number') {
    return coverage >= 0 && coverage <= 1
      ? `${Math.round(coverage * 100)}%`
      : String(coverage);
  }
  const cached = coverage.cachedCellCount ?? coverage.loadedCellCount;
  const total = coverage.selectedCellCount ?? coverage.totalCellCount;
  if (typeof cached === 'number' && typeof total === 'number') return `${cached}/${total}`;
  if (typeof coverage.ratio === 'number') return `${Math.round(coverage.ratio * 100)}%`;
  return JSON.stringify(coverage);
}

export function getContextDisplayName(context: ContextItem): string {
  switch (context.type) {
    case 'file': return context.fileName;
    case 'directory': return context.directoryName;
    case 'code-snippet': return `${context.fileName}:${context.startLine}-${context.endLine}`;
    case 'image': return context.imageName;
    case 'terminal-command': return context.command;
    case 'git-ref': return context.refValue;
    case 'url': return context.title || context.url;
    case 'web-element': return context.tagName;
    case 'product-app-preview-element-selection':
      return context.element.label || context.element.textContent || context.appName || context.appId;
    case 'spreadsheet-focus':
      return spreadsheetFocusDisplayName(context);
    default: {
      const exhaustive: never = context;
      return String(exhaustive);
    }
  }
}

export function getContextTagFormat(context: ContextItem): string {
  switch (context.type) {
    case 'file': return `#file:${context.fileName}`;
    case 'directory': return `#dir:${context.directoryName}`;
    case 'code-snippet': return `#code:${context.fileName}:${context.startLine}-${context.endLine}`;
    case 'image': return `#img:${context.imageName}`;
    case 'terminal-command': return `#cmd:${context.command}`;
    case 'git-ref': return `#git:${context.refValue}`;
    case 'url': return `#link:${context.title || context.url}`;
    case 'web-element': return `#element:${context.tagName}`;
    case 'product-app-preview-element-selection':
      return `#product-app-element:${context.appName || context.appId}`;
    case 'spreadsheet-focus':
      return `#sheet:${encodeURIComponent(context.sheetName)}!${encodeURIComponent(context.a1)}`;
    default: {
      const exhaustive: never = context;
      return String(exhaustive);
    }
  }
}

export function getContextFullPath(context: ContextItem): string {
  switch (context.type) {
    case 'file':
      return context.filePath;
    case 'directory':
      return context.directoryPath + (context.recursive ? ' (recursive)' : '');
    case 'code-snippet':
      return `${context.filePath} (lines ${context.startLine}-${context.endLine})`;
    case 'image':
      return context.imagePath;
    case 'terminal-command':
      return context.workingDirectory ? `${context.command} @ ${context.workingDirectory}` : context.command;
    case 'git-ref':
      return `Git ${context.refType}: ${context.refValue}`;
    case 'url':
      return context.url;
    case 'web-element':
      return context.path;
    case 'product-app-preview-element-selection': {
      const target = context.element.selectorPath || context.element.tagName;
      return `Product App ${context.appId} @ ${context.route}: ${target}`;
    }
    case 'spreadsheet-focus': {
      const path = context.workbookPath ? ` @ ${context.workbookPath}` : '';
      const capturedAt = Number.isFinite(context.capturedAt)
        ? new Date(context.capturedAt).toISOString()
        : 'unknown';
      return [
        `Spreadsheet ${context.role} focus: ${context.sheetName}!${context.a1}${path}`,
        `session=${context.sessionId || 'unbound'}`,
        `workbook=${context.workbookId}`,
        `mode=${context.mode || 'unknown'}`,
        `revision=${context.revision ?? 'unknown'}`,
        `cache=${context.cacheComplete ? 'complete' : 'incomplete'} (${spreadsheetCoverageLabel(context)})`,
        `formulaResults=${spreadsheetFormulaResultsTrustworthy(context) ? 'trusted/no formula risk' : 'stale or unknown'}`,
        `calculationStatus=${JSON.stringify(context.calculationStatus ?? null)}`,
        `fidelity=${JSON.stringify(context.fidelity ?? null)}`,
        `captured=${capturedAt}`,
      ].join(' · ');
    }
    default: {
      const exhaustive: never = context;
      return String(exhaustive);
    }
  }
}

export function createContextTagElement(
  context: ContextItem,
  onRemoveContext: (id: string) => void,
): HTMLSpanElement {
  const tag = document.createElement('span');
  tag.className = 'rich-text-tag-pill';
  tag.contentEditable = 'false';
  tag.dataset.contextId = context.id;
  tag.dataset.contextType = context.type;
  tag.dataset.tagFormat = getContextTagFormat(context);
  tag.title = getContextFullPath(context);

  if (context.type === 'spreadsheet-focus') {
    tag.dataset.contextRole = context.role;
    tag.dataset.sessionId = context.sessionId || '';
    tag.dataset.workbookId = context.workbookId;
    tag.dataset.sheetId = context.sheetId;
    tag.dataset.a1 = context.a1;
    tag.dataset.mode = context.mode || '';
    tag.dataset.revision = context.revision == null ? '' : String(context.revision);
    tag.dataset.cacheComplete = String(context.cacheComplete === true);
    tag.dataset.cacheCoverage = spreadsheetCoverageLabel(context);
    tag.dataset.formulaResultsFresh = context.formulaResultsFresh == null
      ? ''
      : String(context.formulaResultsFresh);
    tag.dataset.capturedAt = Number.isFinite(context.capturedAt) ? String(context.capturedAt) : '';
    tag.setAttribute('aria-label', spreadsheetFocusDisplayName(context));
  }

  const text = document.createElement('span');
  text.className = 'rich-text-tag-pill__text';
  text.textContent = getContextDisplayName(context);

  const remove = document.createElement('button');
  remove.className = 'rich-text-tag-pill__remove';
  remove.textContent = '×';
  remove.title = 'Remove';
  remove.onclick = event => {
    event.preventDefault();
    event.stopPropagation();
    onRemoveContext(context.id);
  };

  tag.appendChild(text);
  tag.appendChild(remove);

  return tag;
}
