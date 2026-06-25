import { state } from "../state.js";
import { asArray, normalizeBox, round2 } from "../util.js";

function parseNodeBounds(node) {
  if (node?.boundsPercent) return normalizeBox(node.boundsPercent);
  const bounds = node?.bounds || node?.rect;
  if (!bounds || !state.screen?.width || !state.screen?.height) return null;
  const text = String(bounds);
  const match = text.match(/(-?\d+)[,\s]+(-?\d+)[,\s]+(-?\d+)[,\s]+(-?\d+)/);
  if (!match) return null;
  const left = Number(match[1]);
  const top = Number(match[2]);
  const right = Number(match[3]);
  const bottom = Number(match[4]);
  if (![left, top, right, bottom].every(Number.isFinite)) return null;
  return normalizeBox({
    x: (left / state.screen.width) * 100,
    y: (top / state.screen.height) * 100,
    width: ((right - left) / state.screen.width) * 100,
    height: ((bottom - top) / state.screen.height) * 100
  });
}

function boxCenter(box) {
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function overlapScore(a, b) {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.width, b.x + b.width);
  const y2 = Math.min(a.y + a.height, b.y + b.height);
  const intersection = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const area = Math.max(1, a.width * a.height);
  return intersection / area;
}

function flattenHierarchyNodes(tree) {
  const nodes = [];
  const stack = asArray(tree?.nodes || tree?.children || tree?.root ? [tree.root || tree] : tree);
  while (stack.length) {
    const node = stack.pop();
    if (!node || typeof node !== "object") continue;
    nodes.push(node);
    asArray(node.children).forEach((child) => stack.push(child));
  }
  return nodes;
}

function matchHierarchyNode(selectionBox) {
  const box = normalizeBox(selectionBox);
  if (!box || !state.hierarchy) return null;
  const center = boxCenter(box);
  let best = null;
  flattenHierarchyNodes(state.hierarchy).forEach((node) => {
    const nodeBox = parseNodeBounds(node);
    if (!nodeBox) return;
    const score = overlapScore(box, nodeBox) * 100 - distance(center, boxCenter(nodeBox));
    if (!best || score > best.score) {
      best = { node, nodeBox, score };
    }
  });
  if (!best) return null;
  return {
    type: best.node.type || best.node.componentType || best.node.className || best.node.name,
    text: best.node.text || best.node.content,
    description: best.node.description || best.node.accessibilityText,
    accessibilityId: best.node.accessibilityId || best.node.id,
    path: best.node.path || best.node.pagePath,
    bounds: best.node.bounds || best.node.rect,
    boundsPercent: best.nodeBox
  };
}

function buildSelection(kind, box) {
  const normalized = normalizeBox(box);
  if (!normalized) return null;
  const node = matchHierarchyNode(normalized);
  const confidence = node
    ? (state.hierarchy?.timestamp && state.screen?.timestamp && Math.abs(Number(state.hierarchy.timestamp) - Number(state.screen.timestamp)) < 5000 ? "high" : "medium")
    : "low";
  return {
    kind,
    screenshotId: state.screen?.id || null,
    boundsPercent: normalized,
    hierarchyNode: node,
    sourceHints: {
      etsFiles: asArray(state.project?.sourceHints?.etsFiles).slice(0, 12),
      componentNames: [
        node?.type,
        ...(asArray(state.project?.sourceHints?.componentNames).slice(0, 8))
      ].filter(Boolean),
      resourceKeys: [],
      confidence
    }
  };
}

function selectionSummary(selection = state.selection) {
  if (!selection) return "none";
  const box = selection.boundsPercent || {};
  const node = selection.hierarchyNode;
  const label = node?.text || node?.description || node?.type || `${round2(box.x)},${round2(box.y)} ${round2(box.width)}x${round2(box.height)}%`;
  return `${selection.kind}: ${label} (${selection.sourceHints?.confidence || "low"})`;
}

export { buildSelection, selectionSummary };
