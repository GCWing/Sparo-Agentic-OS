const VISUAL_DOCUMENT_SCHEMA_VERSION = 1;

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function nowIso() {
  return new Date().toISOString();
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, Number(value)));
}

function normalizedSafeArea(constraints = {}) {
  const safeArea = constraints.safeArea || {};
  return {
    top: clamp(safeArea.top ?? 0, 0, 20),
    right: clamp(safeArea.right ?? 0, 0, 20),
    bottom: clamp(safeArea.bottom ?? 0, 0, 20),
    left: clamp(safeArea.left ?? 0, 0, 20),
  };
}

function normalizeBox(value, current, constraints = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("nodePatch.box must be an object");
  }
  for (const key of Object.keys(value)) {
    if (!["x", "y", "w", "h"].includes(key)) throw new Error(`nodePatch.box contains unsupported field '${key}'`);
    if (!Number.isFinite(Number(value[key]))) throw new Error(`nodePatch.box.${key} must be a finite number`);
  }
  const safeArea = normalizedSafeArea(constraints);
  const maxRight = 100 - safeArea.right;
  const maxBottom = 100 - safeArea.bottom;
  const next = {
    x: value.x === undefined ? current.x : clamp(value.x, safeArea.left, maxRight - 2),
    y: value.y === undefined ? current.y : clamp(value.y, safeArea.top, maxBottom - 2),
    w: value.w === undefined ? current.w : clamp(value.w, 2, 100),
    h: value.h === undefined ? current.h : clamp(value.h, 2, 100),
  };
  next.x = clamp(next.x, safeArea.left, maxRight - 2);
  next.y = clamp(next.y, safeArea.top, maxBottom - 2);
  next.w = Math.min(next.w, maxRight - next.x);
  next.h = Math.min(next.h, maxBottom - next.y);
  return next;
}

function initialVisualDocument(deckId, designPackage = null) {
  return {
    schemaVersion: VISUAL_DOCUMENT_SCHEMA_VERSION,
    deckId,
    revision: 0,
    designPackageId: designPackage?.packageId || "",
    designPackageRevision: Number(designPackage?.revision || 0),
    designHash: designPackage?.contentHash || "",
    pages: [],
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
}

function migrateVisualDocument(value, deckId, designPackage = null) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return initialVisualDocument(deckId, designPackage);
  }
  if (Number(value.schemaVersion || 0) !== VISUAL_DOCUMENT_SCHEMA_VERSION) {
    throw new Error(`VisualDocument schema ${value.schemaVersion ?? "unknown"} is unsupported`);
  }
  return {
    ...clone(value),
    deckId,
    revision: Math.max(0, Number(value.revision || 0)),
    pages: Array.isArray(value.pages) ? clone(value.pages) : [],
    createdAt: value.createdAt || nowIso(),
    updatedAt: value.updatedAt || nowIso(),
  };
}

function applyUserOverrides(baseTree, userOverrides = {}, constraints = {}) {
  const overrides = userOverrides && typeof userOverrides === "object" ? userOverrides : {};
  const seen = new Set();
  const nodes = (baseTree.nodes || []).map((baseNode) => {
    const override = overrides[baseNode.id];
    if (!override) return clone(baseNode);
    seen.add(baseNode.id);
    const next = clone(baseNode);
    if (override.box) next.box = normalizeBox(override.box, next.box, constraints);
    next.locked = Boolean(override.locked);
    next.userAdjusted = true;
    return next;
  });
  return {
    ...clone(baseTree),
    nodes,
    userOverrideCount: seen.size,
    orphanedOverrideIds: Object.keys(overrides).filter((id) => !seen.has(id)),
  };
}

function compileVisualPage(slide, baseTree, existingPage = null, constraints = {}) {
  const userOverrides = clone(existingPage?.userOverrides || {});
  const renderTree = applyUserOverrides(baseTree, userOverrides, constraints);
  return {
    slideId: slide.id,
    revision: Number(existingPage?.revision || 0) + 1,
    slideRevision: Number(slide.revision || 0),
    recipeId: renderTree.recipeId,
    designPackageId: renderTree.designPackageId,
    designPackageRevision: renderTree.designPackageRevision,
    designHash: renderTree.designHash,
    baseTree: clone(baseTree),
    userOverrides,
    renderTree,
    conflicts: renderTree.orphanedOverrideIds.map((nodeId) => ({
      code: "orphaned_user_override",
      nodeId,
      message: `User adjustment for '${nodeId}' could not be applied to the recompiled page.`,
    })),
    createdAt: existingPage?.createdAt || nowIso(),
    updatedAt: nowIso(),
  };
}

function updateVisualNode(page, nodeId, patch, constraints = {}) {
  if (!page) throw new Error("VisualDocument page was not found");
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) throw new Error("nodePatch must be an object");
  for (const key of Object.keys(patch)) {
    if (!["box", "locked"].includes(key)) throw new Error(`nodePatch contains unsupported field '${key}'`);
  }
  const node = (page.renderTree?.nodes || []).find((candidate) => candidate.id === nodeId);
  if (!node) throw new Error(`Visual node '${nodeId}' was not found`);
  const previous = clone(page.userOverrides?.[nodeId] || {});
  const nextOverride = { ...previous };
  if (patch.box !== undefined) nextOverride.box = normalizeBox(patch.box, node.box, constraints);
  if (patch.locked !== undefined) nextOverride.locked = Boolean(patch.locked);
  nextOverride.source = "user";
  nextOverride.updatedAt = nowIso();
  const next = clone(page);
  next.userOverrides = { ...(next.userOverrides || {}), [nodeId]: nextOverride };
  next.revision = Number(next.revision || 0) + 1;
  next.updatedAt = nowIso();
  next.renderTree = applyUserOverrides(next.baseTree, next.userOverrides, constraints);
  next.conflicts = next.renderTree.orphanedOverrideIds.map((orphanedId) => ({
    code: "orphaned_user_override",
    nodeId: orphanedId,
    message: `User adjustment for '${orphanedId}' could not be applied to the recompiled page.`,
  }));
  return { page: next, node: next.renderTree.nodes.find((candidate) => candidate.id === nodeId) };
}

module.exports = {
  VISUAL_DOCUMENT_SCHEMA_VERSION,
  applyUserOverrides,
  compileVisualPage,
  initialVisualDocument,
  migrateVisualDocument,
  updateVisualNode,
};
