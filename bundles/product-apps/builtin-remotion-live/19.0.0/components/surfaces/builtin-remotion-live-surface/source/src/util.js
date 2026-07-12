import { MESSAGES } from './constants.js';
import { state } from './state.js';

function runtime() {
  return window.app || {};
}

function messages() {
  const locale = String(state.locale || 'en-US');
  if (MESSAGES[locale]) return MESSAGES[locale];
  if (locale.toLowerCase().startsWith('zh')) return MESSAGES['zh-CN'];
  return MESSAGES['en-US'];
}

function t(key, params = {}) {
  const template = messages()[key] || MESSAGES['en-US'][key] || key;
  return Object.entries(params).reduce(
    (value, [name, replacement]) => value.replaceAll(`{{${name}}}`, String(replacement ?? '')),
    template,
  );
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
  const element = asElement(node);
  return Boolean(root && element && root.contains(element));
}

function closestElement(target, selector) {
  const element = asElement(target);
  return typeof element?.closest === 'function' ? element.closest(selector) : null;
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
  return document.querySelector('.rl-stage');
}

function dropFrameNumber(frame, fps) {
  const nominal = Math.round(fps);
  const dropFrames = Math.round(nominal * 0.0666666667);
  const framesPerMinute = nominal * 60;
  const framesPerTenMinutes = framesPerMinute * 10 - dropFrames * 9;
  const tenMinuteBlocks = Math.floor(frame / framesPerTenMinutes);
  const remainder = frame % framesPerTenMinutes;
  const extraMinutes = Math.max(0, Math.floor((remainder - dropFrames) / (framesPerMinute - dropFrames)));
  return frame + dropFrames * 9 * tenMinuteBlocks + dropFrames * extraMinutes;
}

function formatSMPTE(frame, fps) {
  const sourceFrame = Math.max(0, Math.round(Number(frame) || 0));
  const rate = Math.max(1, Number(fps) || 30);
  const nominal = Math.max(1, Math.round(rate));
  const dropFrame = Math.abs(rate - 29.97) < 0.02 || Math.abs(rate - 59.94) < 0.02;
  const timecodeFrame = dropFrame ? dropFrameNumber(sourceFrame, rate) : sourceFrame;
  const frames = timecodeFrame % nominal;
  const totalSeconds = Math.floor(timecodeFrame / nominal);
  const seconds = totalSeconds % 60;
  const minutes = Math.floor(totalSeconds / 60) % 60;
  const hours = Math.floor(totalSeconds / 3600);
  const pad = (value) => String(value).padStart(2, '0');
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}${dropFrame ? ';' : ':'}${pad(frames)}`;
}

export {
  asArray,
  asElement,
  bridgeOutput,
  clamp,
  closestElement,
  escapeHtml,
  formatSMPTE,
  nodeInsideRoot,
  previewStageNode,
  projectName,
  rootElement,
  round2,
  runtime,
  t,
  workspaceLabel,
};
