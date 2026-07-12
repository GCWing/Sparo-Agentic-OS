function runtime() {
  return window.app || {};
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function asElement(node) {
  if (!node) return null;
  return node.nodeType === 1 ? node : node.parentElement || null;
}

function closestElement(target, selector) {
  const element = asElement(target);
  return typeof element?.closest === 'function' ? element.closest(selector) : null;
}

function uid(prefix = 'el') {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function bridgeOutput(result) {
  if (result?.bridgeResult?.output !== undefined) return result.bridgeResult.output;
  if (result?.output !== undefined) return result.output;
  return result;
}

function rootElement() {
  return document.getElementById('excelLiveRoot');
}

function cellCacheKey(sheetId, row, col) {
  return `${sheetId}:${row},${col}`;
}

function normalizePathForCompare(value) {
  const normalized = String(value || '').replaceAll('\\', '/');
  const platform = typeof navigator === 'undefined'
    ? ''
    : String(navigator.userAgentData?.platform || navigator.platform || '');
  return /^win/i.test(platform) ? normalized.toLowerCase() : normalized;
}

export {
  asElement,
  bridgeOutput,
  cellCacheKey,
  clamp,
  closestElement,
  escapeHtml,
  normalizePathForCompare,
  rootElement,
  runtime,
  uid,
};
