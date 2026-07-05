import { MESSAGES, normalizeRoute } from "./constants.js";
import { state } from "./state.js";

function runtime() {
  return window.app || {};
}

function messages() {
  return MESSAGES[state.locale] || MESSAGES[state.locale.split("-")[0]] || MESSAGES["en-US"];
}

function t(key, params = {}) {
  const template = messages()[key] || MESSAGES["en-US"][key] || key;
  return Object.entries(params).reduce(
    (value, [name, replacement]) => value.replaceAll(`{{${name}}}`, String(replacement ?? "")),
    template
  );
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function bridgeOutput(result) {
  if (result?.bridgeResult?.output !== undefined) return result.bridgeResult.output;
  if (result?.output !== undefined) return result.output;
  return result;
}

function rootElement() {
  return document.getElementById("harmonyDevRoot");
}

function asElement(node) {
  if (!node) return null;
  return node.nodeType === 1 ? node : node.parentElement || null;
}

function closestElement(target, selector) {
  const element = asElement(target);
  return typeof element?.closest === "function" ? element.closest(selector) : null;
}

function workspaceLabel() {
  const workspace = state.workspacePath || "";
  if (!workspace) return "-";
  return workspace.split(/[\\/]/).filter(Boolean).pop() || workspace;
}

function routeKey(route = state.route) {
  return normalizeRoute(route).replace("/", "") || "preview";
}

function formatTime(value) {
  if (!value) return "-";
  const date = typeof value === "number" ? new Date(value) : new Date(String(value));
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function shortPath(value) {
  const text = String(value || "");
  if (!text) return "-";
  const parts = text.split(/[\\/]/).filter(Boolean);
  return parts.length > 4 ? `.../${parts.slice(-4).join("/")}` : text.replace(/\\/g, "/");
}

function round2(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function normalizeBox(box) {
  if (!box) return null;
  const x = clamp(Number(box.x) || 0, 0, 100);
  const y = clamp(Number(box.y) || 0, 0, 100);
  const width = clamp(Number(box.width) || 0, 0, 100 - x);
  const height = clamp(Number(box.height) || 0, 0, 100 - y);
  return { x: round2(x), y: round2(y), width: round2(width), height: round2(height) };
}

function statusLabel(status) {
  if (!status) return t("unknown");
  if (status === "completed" || status === "done" || status === "ok") return t("completed");
  if (status === "failed" || status === "error") return t("failed");
  if (status === "started" || status === "running") return t("started");
  return String(status);
}

function primaryDiagnostic() {
  return asArray(state.diagnostics)[0]
    || asArray(state.build?.diagnostics)[0]
    || asArray(state.runtimeState?.diagnostics)[0]
    || null;
}

function stagePointFromEvent(event) {
  const stage = closestElement(event.target, "[data-select-stage]") || document.querySelector("[data-select-stage]");
  if (!stage) return null;
  const rect = stage.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return null;
  return {
    x: round2(((event.clientX - rect.left) / rect.width) * 100),
    y: round2(((event.clientY - rect.top) / rect.height) * 100)
  };
}

export {
  asArray,
  bridgeOutput,
  clamp,
  closestElement,
  escapeHtml,
  formatTime,
  normalizeBox,
  primaryDiagnostic,
  rootElement,
  routeKey,
  round2,
  runtime,
  shortPath,
  stagePointFromEvent,
  statusLabel,
  t,
  workspaceLabel
};
