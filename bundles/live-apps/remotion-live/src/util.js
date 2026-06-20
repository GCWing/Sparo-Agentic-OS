// remotion-live :: util.js (auto-split from ui.js; do not hand-merge)

import { MESSAGES, normalizeRoute } from './constants.js';
import { state } from './state.js';

function cacheGet(cache, key) {
  if (!key || !cache.has(key)) return null;
  const value = cache.get(key);
  cache.delete(key);
  cache.set(key, value);
  return value;
}


function cacheSet(cache, key, value, limit) {
  if (!key || !value) return value;
  cache.delete(key);
  cache.set(key, value);
  while (cache.size > limit) {
    const oldestKey = cache.keys().next().value;
    cache.delete(oldestKey);
  }
  return value;
}


function runtime() {
  return window.app || {};
}


function messages() {
  return MESSAGES[state.locale] || MESSAGES[state.locale.split('-')[0]] || MESSAGES['en-US'];
}


function t(key, params = {}) {
  const template = messages()[key] || MESSAGES['en-US'][key] || key;
  return Object.entries(params).reduce(
    (value, [name, replacement]) => value.replaceAll(`{{${name}}}`, String(replacement ?? '')),
    template,
  );
}


function routeKey(route = state.route) {
  return normalizeRoute(route).replace('/', '') || 'preview';
}


function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}


function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}


function asArray(value) {
  return Array.isArray(value) ? value : [];
}


function projectName() {
  return state.project?.projectName || state.project?.name || 'Remotion';
}


function workspaceLabel() {
  const path = state.workspacePath || '';
  if (!path) return '-';
  return path.split(/[\\/]/).filter(Boolean).pop() || path;
}


function rootElement() {
  return document.getElementById('remotionLiveRoot');
}


function asElement(node) {
  if (!node) return null;
  return node.nodeType === 1 ? node : node.parentElement || null;
}


function nodeInsideRoot(node) {
  const root = rootElement();
  if (!root || !node) return false;
  const element = asElement(node);
  return Boolean(element && root.contains(element));
}


function closestElement(target, selector) {
  const element = asElement(target);
  return typeof element?.closest === 'function' ? element.closest(selector) : null;
}


function stopPlaybackTimer() {
  if (state.playTimer) {
    clearInterval(state.playTimer);
    state.playTimer = null;
  }
}


function bridgeOutput(result) {
  if (result?.bridgeResult?.output !== undefined) return result.bridgeResult.output;
  if (result?.output !== undefined) return result.output;
  return result;
}


function round2(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}


function previewStageNode() {
  return document.querySelector('.rl-stage:not(.rl-stage--studio)');
}


function formatSMPTE(frame, fps) {
  const f = Math.max(0, Math.round(frame));
  const safeFps = Math.max(1, Math.round(fps || 30));
  const fr = f % safeFps;
  const totalSec = Math.floor(f / safeFps);
  const s = totalSec % 60;
  const m = Math.floor(totalSec / 60) % 60;
  const h = Math.floor(totalSec / 3600);
  const p = (n, d) => String(n).padStart(d, '0');
  return `${p(h, 2)}:${p(m, 2)}:${p(s, 2)}:${p(fr, 2)}`;
}

// ─── Inline timeline ──────────────────────────────────────────────────────────
// Design references: DaVinci Resolve, Premiere Pro, Final Cut Pro.
// Single seek control (no duplicate scrubber in transport).
// Supports zoom so users can see frame-level detail on dense compositions.


export { asArray, asElement, bridgeOutput, cacheGet, cacheSet, clamp, closestElement, escapeHtml, formatSMPTE, nodeInsideRoot, previewStageNode, projectName, rootElement, round2, routeKey, runtime, stopPlaybackTimer, t, workspaceLabel };
