import { colToIndex } from './a1.js';

const LIVE_VIEW_SEMANTICS = 'values-formulas-styles-layout';

const STYLE_ROLE_FALLBACKS = Object.freeze({
  title: {
    fill: { color: '#17365D' },
    font: { bold: true, color: '#FFFFFF', size: 14 },
    alignment: { vertical: 'middle' },
  },
  header: {
    fill: { color: '#1F4E78' },
    font: { bold: true, color: '#FFFFFF' },
    border: { bottom: { style: 'thin', color: '#17365D' } },
    alignment: { vertical: 'middle', wrapText: true },
  },
  total: {
    font: { bold: true },
    border: { top: { style: 'double', color: '#1F1F1F' } },
  },
  input: {
    fill: { color: '#FFF2CC' },
    border: { bottom: { style: 'thin', color: '#D6B656' } },
  },
  output: {
    fill: { color: '#DDEBF7' },
    font: { color: '#17365D' },
  },
  note: {
    font: { italic: true, color: '#666666' },
    alignment: { wrapText: true },
  },
  warning: {
    fill: { color: '#FCE4D6' },
    font: { bold: true, color: '#C00000' },
  },
});

const ALIGNMENTS = new Set(['left', 'center', 'right', 'justify', 'general']);
const VERTICAL_ALIGNMENTS = new Set(['top', 'middle', 'bottom']);
const BORDER_STYLES = new Set(['hair', 'thin', 'medium', 'thick', 'double', 'dashed', 'dotted']);

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function normalizeStyleRole(value) {
  const role = String(value || '').trim().toLowerCase().replaceAll('_', '-');
  return Object.prototype.hasOwnProperty.call(STYLE_ROLE_FALLBACKS, role) ? role : '';
}

function normalizeColor(value) {
  let candidate = value;
  if (candidate && typeof candidate === 'object') {
    candidate = candidate.color ?? candidate.rgb ?? candidate.argb ?? candidate.value;
  }
  let token = String(candidate || '').trim().replace(/^#/, '');
  if (/^[0-9a-f]{8}$/i.test(token)) token = token.slice(2);
  if (/^[0-9a-f]{3}$/i.test(token)) token = token.split('').map((part) => `${part}${part}`).join('');
  return /^[0-9a-f]{6}$/i.test(token) ? `#${token.toUpperCase()}` : null;
}

function normalizeBorderSide(value) {
  if (!value) return null;
  const source = typeof value === 'string' ? { style: value } : asObject(value);
  let style = String(source.style || source.lineStyle || 'thin').trim().toLowerCase();
  if (!BORDER_STYLES.has(style)) style = 'thin';
  const color = normalizeColor(source.color) || '#AEB5BE';
  return { style, color };
}

function mergeStyle(base, override) {
  const left = asObject(base);
  const right = asObject(override);
  return {
    ...left,
    ...right,
    fill: { ...asObject(left.fill), ...asObject(right.fill) },
    font: { ...asObject(left.font), ...asObject(right.font) },
    border: { ...asObject(left.border), ...asObject(right.border) },
    alignment: { ...asObject(left.alignment), ...asObject(right.alignment) },
  };
}

function normalizeCellStyle(styleLike, fallbackRole = '') {
  const source = asObject(styleLike);
  const role = normalizeStyleRole(source.role || fallbackRole);
  const merged = mergeStyle(role ? STYLE_ROLE_FALLBACKS[role] : {}, source);
  const fillColor = normalizeColor(merged.fill?.color ?? merged.fill);
  const fontColor = normalizeColor(merged.font?.color);
  const fontSizeValue = Number(merged.font?.size);
  const horizontal = String(merged.alignment?.horizontal || '').trim().toLowerCase();
  let vertical = String(merged.alignment?.vertical || '').trim().toLowerCase();
  if (vertical === 'center') vertical = 'middle';
  const border = {};
  for (const side of ['top', 'right', 'bottom', 'left']) {
    const normalized = normalizeBorderSide(merged.border?.[side]);
    if (normalized) border[side] = normalized;
  }
  const numberFormat = typeof merged.numberFormat === 'string'
    ? merged.numberFormat.trim().slice(0, 120)
    : '';
  return {
    role: role || null,
    fill: fillColor ? { color: fillColor } : null,
    font: {
      bold: merged.font?.bold === true,
      italic: merged.font?.italic === true,
      color: fontColor,
      size: Number.isFinite(fontSizeValue) ? Math.min(72, Math.max(6, fontSizeValue)) : null,
    },
    border,
    alignment: {
      horizontal: ALIGNMENTS.has(horizontal) ? horizontal : null,
      vertical: VERTICAL_ALIGNMENTS.has(vertical) ? vertical : null,
      wrapText: merged.alignment?.wrapText === true,
    },
    numberFormat: numberFormat || null,
  };
}

function cellStyle(cell) {
  if (!cell || typeof cell !== 'object') return normalizeCellStyle(null);
  const style = asObject(cell.style);
  return normalizeCellStyle(style, cell.styleRole || cell.role);
}

function borderCss(side) {
  if (!side) return null;
  const widths = { hair: 1, thin: 1, medium: 2, thick: 3, double: 3, dashed: 1, dotted: 1 };
  const cssStyle = side.style === 'double'
    ? 'double'
    : side.style === 'dashed'
      ? 'dashed'
      : side.style === 'dotted' || side.style === 'hair'
        ? 'dotted'
        : 'solid';
  return `${widths[side.style] || 1}px ${cssStyle} ${side.color}`;
}

function styleToCss(styleLike, fallbackRole = '') {
  const style = normalizeCellStyle(styleLike, fallbackRole);
  const declarations = [];
  if (style.fill?.color) declarations.push(`background-color:${style.fill.color}`);
  if (style.font.color) declarations.push(`color:${style.font.color}`);
  if (style.font.bold) declarations.push('font-weight:700');
  if (style.font.italic) declarations.push('font-style:italic');
  // Excel font sizes are points; CSS uses px at the standard 96 dpi scale.
  if (style.font.size) declarations.push(`font-size:${Math.round(style.font.size * 96 / 72 * 100) / 100}px`);
  if (style.alignment.horizontal && style.alignment.horizontal !== 'general') {
    declarations.push(`text-align:${style.alignment.horizontal}`);
    declarations.push(`justify-content:${style.alignment.horizontal === 'center' ? 'center' : style.alignment.horizontal === 'right' ? 'flex-end' : 'flex-start'}`);
  }
  if (style.alignment.vertical) {
    const alignItems = style.alignment.vertical === 'middle'
      ? 'center'
      : style.alignment.vertical === 'top'
        ? 'flex-start'
        : 'flex-end';
    declarations.push(`align-items:${alignItems}`);
  }
  if (style.alignment.wrapText) declarations.push('white-space:normal');
  for (const side of ['top', 'right', 'bottom', 'left']) {
    const value = borderCss(style.border[side]);
    if (value) declarations.push(`border-${side}:${value}`);
  }
  return declarations.join(';');
}

function decimalPlaces(format, marker = '.') {
  const escapedMarker = marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = String(format || '').match(new RegExp(`${escapedMarker}(0+)`));
  return match ? match[1].length : 0;
}

function formatValueWithNumberFormat(value, format) {
  if (typeof value !== 'number' || !Number.isFinite(value) || !format) return value == null ? '' : String(value);
  const token = String(format).trim();
  if (!token || /^general$/i.test(token)) return String(value);
  const firstSection = token.split(';')[0];
  // Basic 1900-date-system preview only. Locale calendars, time zones, and
  // alternate Excel date systems remain fidelity metadata concerns.
  if (/y{2,4}[-/]m{1,2}[-/]d{1,2}/i.test(firstSection)) {
    const serialDay = Math.floor(value);
    // Excel intentionally preserves Lotus 1-2-3's fictitious leap day.
    if (serialDay === 60) return '1900-02-29';
    const adjustedDay = serialDay >= 60 ? serialDay - 1 : serialDay;
    const date = new Date(Date.UTC(1899, 11, 31) + adjustedDay * 86400000);
    if (!Number.isNaN(date.getTime())) {
      const year = String(date.getUTCFullYear()).padStart(4, '0');
      const month = String(date.getUTCMonth() + 1).padStart(2, '0');
      const day = String(date.getUTCDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    }
  }
  const fractionDigits = decimalPlaces(firstSection);
  if (firstSection.includes('%')) {
    return `${(value * 100).toLocaleString(undefined, { minimumFractionDigits: fractionDigits, maximumFractionDigits: fractionDigits })}%`;
  }
  const currency = firstSection.match(/[$¥￥€£]/)?.[0] || '';
  const useGrouping = firstSection.includes(',');
  const formatted = value.toLocaleString(undefined, {
    useGrouping,
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  });
  return currency ? `${currency}${formatted}` : formatted;
}

function cellDisplayWithStyle(cell) {
  if (!cell) return '';
  if (cell.v != null) return formatValueWithNumberFormat(cell.v, cellStyle(cell).numberFormat);
  const formula = cell.f ?? cell.formula;
  return formula ? `=${String(formula).replace(/^=/, '')}` : '';
}

function snapshotParts(snapshot) {
  if (!snapshot) return { primary: '', secondary: '', formula: '', value: '' };
  const formulaValue = snapshot.f ?? snapshot.formula;
  const formula = formulaValue ? `=${String(formulaValue).replace(/^=/, '')}` : '';
  const value = snapshot.v ?? snapshot.value;
  const displayValue = value == null ? '' : formatValueWithNumberFormat(value, cellStyle(snapshot).numberFormat);
  return {
    primary: formula || displayValue,
    secondary: formula && displayValue ? displayValue : '',
    formula,
    value: displayValue,
  };
}

function styleSignature(style) {
  return JSON.stringify(normalizeCellStyle(style));
}

function styleDifferences(before, after) {
  const left = cellStyle(before);
  const right = cellStyle(after);
  if (styleSignature(left) === styleSignature(right)) return [];
  const diffs = [];
  const push = (key, beforeValue, afterValue) => {
    if (JSON.stringify(beforeValue ?? null) !== JSON.stringify(afterValue ?? null)) {
      diffs.push({ key, before: beforeValue ?? null, after: afterValue ?? null });
    }
  };
  push('role', left.role, right.role);
  push('fill', left.fill?.color, right.fill?.color);
  push('font', left.font, right.font);
  push('border', left.border, right.border);
  push('alignment', left.alignment, right.alignment);
  push('numberFormat', left.numberFormat, right.numberFormat);
  return diffs;
}

function messageText(value) {
  if (typeof value === 'string') return value.trim();
  if (!value || typeof value !== 'object') return String(value ?? '').trim();
  return String(value.message || value.text || value.description || value.code || '').trim();
}

function asMessages(value) {
  if (!Array.isArray(value)) return [];
  return value.map(messageText).filter(Boolean);
}

function proposalValidationDetails(proposal) {
  const validation = proposal?.validation;
  const errors = [];
  const warnings = [];
  let status = '';
  let explicitlyInvalid = validation === false;
  if (typeof validation === 'string') status = validation;
  if (Array.isArray(validation)) warnings.push(...asMessages(validation));
  if (validation && typeof validation === 'object' && !Array.isArray(validation)) {
    status = String(validation.status || validation.state || '').trim().toLowerCase();
    explicitlyInvalid = validation.valid === false || validation.invalid === true;
    errors.push(...asMessages(validation.errors));
    warnings.push(...asMessages(validation.warnings));
    const formulaLint = validation.formulaLint || proposal?.formulaLint;
    if (formulaLint && typeof formulaLint === 'object') {
      errors.push(...asMessages(formulaLint.errors));
      warnings.push(...asMessages(formulaLint.warnings));
      for (const finding of formulaLint.findings || []) {
        const text = messageText(finding);
        if (!text) continue;
        const severity = String(finding?.severity || finding?.level || '').toLowerCase();
        if (severity === 'error' || severity === 'fatal') errors.push(text);
        else warnings.push(text);
      }
    }
  }
  const invalidStatus = ['invalid', 'failed', 'error', 'blocked'].includes(status);
  return {
    status,
    errors: [...new Set(errors)],
    warnings: [...new Set(warnings)],
    invalid: explicitlyInvalid || invalidStatus || errors.length > 0,
  };
}

function normalizeAxisIndex(value, kind) {
  if (Number.isInteger(Number(value))) return Math.max(0, Number(value));
  if (kind === 'column' && typeof value === 'string') {
    try {
      return colToIndex(value);
    } catch (_error) {
      return 0;
    }
  }
  return 0;
}

function normalizeLayoutRanges(entries, kind) {
  if (!Array.isArray(entries)) return [];
  return entries.map((entry) => {
    const source = asObject(entry);
    const start = normalizeAxisIndex(source.start ?? source.index ?? source[`${kind}Start`] ?? source[`${kind}Index`], kind);
    const end = normalizeAxisIndex(source.end ?? source.index ?? source[`${kind}End`] ?? source[`${kind}Index`] ?? start, kind);
    const explicitPixels = Number(source[kind === 'column' ? 'widthPx' : 'heightPx']);
    const sourceValue = Number(source[kind === 'column' ? 'width' : 'height']);
    // Engine/XLSX contract: column width is Excel character units and row
    // height is points. Convert only for presentation; retain the source value
    // so proposal details remain meaningful in workbook units.
    const convertedSize = Number.isFinite(explicitPixels)
      ? explicitPixels
      : Number.isFinite(sourceValue)
        ? kind === 'column'
          ? excelColumnWidthToPixels(sourceValue)
          : excelRowHeightToPixels(sourceValue)
        : NaN;
    const min = kind === 'column' ? 12 : 1;
    const max = kind === 'column' ? excelColumnWidthToPixels(255) : excelRowHeightToPixels(409);
    return {
      start: Math.min(start, end),
      end: Math.max(start, end),
      size: Number.isFinite(convertedSize) ? Math.min(max, Math.max(min, convertedSize)) : null,
      value: Number.isFinite(sourceValue) ? sourceValue : null,
      unit: kind === 'column' ? 'excelCharacters' : 'points',
      autoFit: source.autoFit === true,
    };
  }).filter((entry) => entry.size != null || entry.autoFit);
}

function excelColumnWidthToPixels(width) {
  const value = Math.min(255, Math.max(0, Number(width) || 0));
  return Math.floor(value * 7 + 5);
}

function excelRowHeightToPixels(height) {
  const value = Math.min(409, Math.max(0, Number(height) || 0));
  return Math.round(value * 96 / 72 * 100) / 100;
}

function normalizeSheetLayout(layoutLike) {
  const layout = asObject(layoutLike);
  const freeze = asObject(layout.freezePanes || layout.freeze || layout.frozenPanes);
  const filter = layout.autoFilter;
  return {
    columns: normalizeLayoutRanges(layout.columns || layout.columnWidths, 'column'),
    rows: normalizeLayoutRanges(layout.rows || layout.rowHeights, 'row'),
    freezePanes: {
      rows: Math.max(0, Number(freeze.rows ?? freeze.rowCount ?? freeze.frozenRows) || 0),
      columns: Math.max(0, Number(freeze.columns ?? freeze.columnCount ?? freeze.frozenColumns) || 0),
    },
    autoFilter: typeof filter === 'string'
      ? { a1: filter }
      : filter && typeof filter === 'object'
        ? { a1: String(filter.a1 || filter.range || '').trim() || null }
        : null,
  };
}

function proposalLayoutStates(proposal) {
  const layout = proposal?.layout;
  if (!layout || typeof layout !== 'object') return null;
  const hasEnvelope = Object.prototype.hasOwnProperty.call(layout, 'before')
    || Object.prototype.hasOwnProperty.call(layout, 'after');
  return {
    before: normalizeSheetLayout(hasEnvelope ? layout.before : null),
    after: normalizeSheetLayout(hasEnvelope ? layout.after : layout),
  };
}

function proposalHasLayoutChanges(proposal) {
  const states = proposalLayoutStates(proposal);
  return Boolean(states && JSON.stringify(states.before) !== JSON.stringify(states.after));
}

function axisSizeAt(index, entries, defaultSize, autoFitSize = defaultSize) {
  let size = defaultSize;
  for (const entry of entries || []) {
    if (index < entry.start || index > entry.end) continue;
    size = entry.size ?? (entry.autoFit ? autoFitSize : defaultSize);
  }
  return size;
}

function axisOffset(index, entries, defaultSize, autoFitSize = defaultSize) {
  const target = Math.max(0, Number(index) || 0);
  let offset = target * defaultSize;
  for (const entry of entries || []) {
    const coveredStart = Math.max(0, entry.start);
    const coveredEnd = Math.min(target - 1, entry.end);
    if (coveredEnd < coveredStart) continue;
    const count = coveredEnd - coveredStart + 1;
    const size = entry.size ?? (entry.autoFit ? autoFitSize : defaultSize);
    offset += count * (size - defaultSize);
  }
  return offset;
}

function axisIndexAtOffset(offset, count, entries, defaultSize, autoFitSize = defaultSize) {
  const safeCount = Math.max(1, Number(count) || 1);
  const target = Math.max(0, Number(offset) || 0);
  let low = 0;
  let high = safeCount - 1;
  while (low < high) {
    const mid = Math.floor((low + high + 1) / 2);
    if (axisOffset(mid, entries, defaultSize, autoFitSize) <= target) low = mid;
    else high = mid - 1;
  }
  return low;
}

function layoutDifferences(proposal) {
  const states = proposalLayoutStates(proposal);
  if (!states) return [];
  const diffs = [];
  for (const key of ['columns', 'rows', 'freezePanes', 'autoFilter']) {
    if (JSON.stringify(states.before[key]) !== JSON.stringify(states.after[key])) {
      diffs.push({ key, before: states.before[key], after: states.after[key] });
    }
  }
  return diffs;
}

export {
  LIVE_VIEW_SEMANTICS,
  STYLE_ROLE_FALLBACKS,
  axisIndexAtOffset,
  axisOffset,
  axisSizeAt,
  cellDisplayWithStyle,
  cellStyle,
  excelColumnWidthToPixels,
  excelRowHeightToPixels,
  formatValueWithNumberFormat,
  normalizeCellStyle,
  normalizeColor,
  normalizeSheetLayout,
  normalizeStyleRole,
  layoutDifferences,
  proposalHasLayoutChanges,
  proposalLayoutStates,
  proposalValidationDetails,
  snapshotParts,
  styleDifferences,
  styleToCss,
};
