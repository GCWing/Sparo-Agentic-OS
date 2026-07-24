/**
 * Sparo Excel Engine — workbook session API for Excel Live bridge.
 */

const fs = require("node:fs");
const path = require("node:path");
const {
  createEmpty,
  loadJson,
  saveJson,
  ensureDir,
  workbookDir,
  getSheet,
  findSheetByName,
  findWorkbookIdByPath,
  listWorkbookMetas,
  cellKey,
  createEmptySheet,
  newId,
  nowIso,
  normalizeWorkbook,
  normalizeMode,
  normalizeSheetLayout,
  validateExcelSheetName,
  validateWorkbookId,
} = require("./workbook-store");
const {
  EXCEL_MAX_COLUMNS,
  EXCEL_MAX_ROWS,
  assertCellCoordinates,
  assertSheetDimensions,
  parseA1,
  formatA1,
  cellCount,
  clampRange,
} = require("./a1");
const { serializeCsv } = require("./csv-io");
const {
  readWorkbookFile,
  readStableFile,
  fingerprintsEqual,
  writeWorkbookFile,
  writeFileAtomic,
  sheetToMatrix,
} = require("./xlsx-io");

const DEFAULT_MAX_CELLS = 2000;
const MAX_READ_RANGE_CELLS = 20_000;
const MAX_HISTORY = 500;
const MAX_UNDO_STACK = 100;
const MAX_PROPOSAL_CELLS = 5_000;
const MAX_LOCAL_PATCH_CELLS = 20_000;
const MAX_ACCEPT_SELECTION_CELLS = 5_000;
const MAX_WORKBOOK_CELLS = 500_000;
const MAX_LAYOUT_BANDS = 5_000;
const MAX_CUSTOM_LAYOUT_ROWS = 20_000;
const sessions = new Map();

function requireWorkspace(input) {
  const workspacePath = input && input.workspacePath;
  if (!workspacePath || typeof workspacePath !== "string") {
    throw new Error(
      "[INVALID_WORKSPACE_PATH] workspacePath is required and must be injected by the host as an absolute path."
    );
  }
  if (workspacePath.includes("\0") || !path.isAbsolute(workspacePath)) {
    throw new Error(
      "[INVALID_WORKSPACE_PATH] workspacePath must be a host-provided absolute path without NUL characters."
    );
  }
  return path.resolve(workspacePath);
}

function requireWorkbookId(input) {
  const workbookId = input && input.workbookId;
  if (!workbookId || typeof workbookId !== "string") {
    throw new Error("workbookId is required");
  }
  return validateWorkbookId(workbookId);
}

function trustedConsumerToken(input) {
  return String(input?.__trustedConsumerKind || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z]/g, "");
}

function assertConsumerPathAllowed(input, workspacePath, targetPath, action) {
  if (trustedConsumerToken(input) !== "agentcomponent") return targetPath;
  const workspaceIdentity = canonicalPathIdentity(workspacePath);
  const targetIdentity = canonicalPathIdentity(targetPath);
  const prefix = workspaceIdentity.endsWith(path.sep)
    ? workspaceIdentity
    : `${workspaceIdentity}${path.sep}`;
  if (targetIdentity !== workspaceIdentity && !targetIdentity.startsWith(prefix)) {
    throw new Error(
      `[WORKSPACE_PATH_REQUIRED] ${action} must stay inside the host workspace. Product App file dialogs are the only supported way to authorize an external path.`
    );
  }
  return targetPath;
}

function resolveConsumerPath(input, workspacePath, value, action) {
  if (typeof value !== "string" || !value.trim() || value.includes("\0")) {
    throw new Error(`${action} path must be a non-empty string without NUL characters`);
  }
  const resolved = path.isAbsolute(value)
    ? path.resolve(value)
    : path.resolve(workspacePath, value);
  return assertConsumerPathAllowed(input, workspacePath, resolved, action);
}

function prepareAtomicTargetWrite(input, targetPath, sourcePath = null) {
  if (!fs.existsSync(targetPath)) {
    return { expectTargetMissing: true };
  }
  if (sourcePath && pathsReferToSameFile(targetPath, sourcePath)) {
    return {};
  }
  const productAppConfirmed = trustedConsumerToken(input) === "productappruntime"
    && input.overwriteExisting === true;
  if (!productAppConfirmed) {
    throw new Error(
      `[EXISTING_TARGET_OVERWRITE_BLOCKED] ${targetPath} already exists. Choose a new file name, or confirm replacement in the Product App save dialog.`
    );
  }
  const currentFingerprint = readStableFile(targetPath).fingerprint;
  if (
    input.expectedTargetFingerprint
    && !fingerprintsEqual(input.expectedTargetFingerprint, currentFingerprint)
  ) {
    throw new Error(
      `[EXPORT_TARGET_CHANGED] ${targetPath} changed after overwrite confirmation. Reopen the save dialog and review the current file before replacing it.`
    );
  }
  return { expectedTargetFingerprint: currentFingerprint };
}

function touch(workbook) {
  workbook.updatedAt = nowIso();
  return workbook;
}

function persist(workspacePath, workbook) {
  assertWorkbookWithinLimits(workbook);
  reconcileCalculationStatus(workbook);
  const saved = saveJson(workspacePath, touch(workbook));
  sessions.set(saved.workbookId, { workspacePath, workbook: saved });
  return saved;
}

function cloneJson(value) {
  if (value == null) return value;
  return JSON.parse(JSON.stringify(value));
}

function cloneCell(cell) {
  return cell ? cloneJson(cell) : null;
}

const STYLE_ROLES = Object.freeze({
  title: {
    fill: { color: "#17365D" },
    font: { bold: true, color: "#FFFFFF", size: 14 },
    alignment: { vertical: "center" },
  },
  header: {
    fill: { color: "#1F4E78" },
    font: { bold: true, color: "#FFFFFF" },
    border: { bottom: { style: "thin", color: "#17365D" } },
    alignment: { vertical: "center", wrapText: true },
  },
  input: {
    fill: { color: "#FFF2CC" },
    border: { bottom: { style: "thin", color: "#D6B656" } },
  },
  output: {
    fill: { color: "#DDEBF7" },
    font: { color: "#17365D" },
  },
  total: {
    font: { bold: true },
    border: { top: { style: "double", color: "#1F1F1F" } },
  },
  note: {
    font: { italic: true, color: "#666666" },
    alignment: { wrapText: true },
  },
  warning: {
    fill: { color: "#FCE4D6" },
    font: { bold: true, color: "#C00000" },
  },
});

const BORDER_STYLES = new Set([
  "hair", "dotted", "dashDotDot", "dashDot", "dashed", "thin", "mediumDashDotDot",
  "slantDashDot", "mediumDashDot", "mediumDashed", "medium", "thick", "double",
]);
const HORIZONTAL_ALIGNMENTS = new Set(["general", "left", "center", "right", "fill", "justify", "centerContinuous", "distributed"]);
const VERTICAL_ALIGNMENTS = new Set(["top", "center", "bottom", "justify", "distributed"]);

function mergeObjects(base, override) {
  const result = cloneJson(base) || {};
  for (const [key, value] of Object.entries(override || {})) {
    if (value === undefined) continue;
    if (value === null) {
      delete result[key];
    } else if (value && typeof value === "object" && !Array.isArray(value)) {
      result[key] = mergeObjects(result[key], value);
    } else {
      result[key] = value;
    }
  }
  return result;
}

function normalizeColor(value, context) {
  if (typeof value !== "string") throw new Error(`${context} color must be a hex string`);
  let color = value.trim().toUpperCase();
  if (/^#[0-9A-F]{3}$/.test(color)) {
    color = `#${color[1]}${color[1]}${color[2]}${color[2]}${color[3]}${color[3]}`;
  }
  if (/^[0-9A-F]{6}$/.test(color)) color = `#${color}`;
  if (!/^#[0-9A-F]{6}$/.test(color)) {
    throw new Error(`${context} color must use #RRGGBB`);
  }
  return color;
}

function normalizeBorderSide(value, context) {
  if (typeof value === "string") value = { style: value };
  if (!value || typeof value !== "object") throw new Error(`${context} must be an object or border style`);
  const style = value.style == null ? "thin" : String(value.style);
  if (!BORDER_STYLES.has(style)) throw new Error(`${context}.style is not a supported Excel border style`);
  const result = { style };
  if (value.color != null) result.color = normalizeColor(value.color, context);
  return result;
}

function normalizeStyle(style, styleRole, baseStyle = null) {
  if (style === undefined && styleRole === undefined) return cloneJson(baseStyle) || null;
  if (style === null && (styleRole == null || styleRole === "")) return null;
  if (style != null && typeof style !== "object") throw new Error("cell style must be an object or null");
  const requestedRole = styleRole || style?.role || null;
  if (requestedRole && !Object.prototype.hasOwnProperty.call(STYLE_ROLES, requestedRole)) {
    throw new Error(`styleRole must be one of: ${Object.keys(STYLE_ROLES).join(", ")}`);
  }
  let merged = cloneJson(baseStyle) || {};
  if (requestedRole && merged.role && merged.role !== requestedRole) {
    merged = merged.numberFormat ? { numberFormat: merged.numberFormat } : {};
  }
  if (requestedRole) merged = mergeObjects(merged, STYLE_ROLES[requestedRole]);
  merged = mergeObjects(merged, style || {});
  if (requestedRole) merged.role = requestedRole;
  else if (merged.role && !Object.prototype.hasOwnProperty.call(STYLE_ROLES, merged.role)) delete merged.role;

  const result = {};
  if (merged.role) result.role = merged.role;
  if (merged.fill != null) {
    if (typeof merged.fill !== "object" || merged.fill.color == null) throw new Error("style.fill requires color");
    result.fill = { color: normalizeColor(merged.fill.color, "style.fill") };
  }
  if (merged.font != null) {
    if (typeof merged.font !== "object") throw new Error("style.font must be an object");
    const font = {};
    if (merged.font.bold != null) {
      if (typeof merged.font.bold !== "boolean") throw new Error("style.font.bold must be boolean");
      if (merged.font.bold) font.bold = true;
    }
    if (merged.font.italic != null) {
      if (typeof merged.font.italic !== "boolean") throw new Error("style.font.italic must be boolean");
      if (merged.font.italic) font.italic = true;
    }
    if (merged.font.color != null) font.color = normalizeColor(merged.font.color, "style.font");
    if (merged.font.size != null) {
      const size = Number(merged.font.size);
      if (!Number.isFinite(size) || size < 6 || size > 72) throw new Error("style.font.size must be between 6 and 72 points");
      font.size = size;
    }
    if (Object.keys(font).length) result.font = font;
  }
  if (merged.border != null) {
    if (typeof merged.border !== "object") throw new Error("style.border must be an object");
    const border = {};
    for (const side of ["top", "right", "bottom", "left"]) {
      if (merged.border[side] != null) border[side] = normalizeBorderSide(merged.border[side], `style.border.${side}`);
    }
    if (Object.keys(border).length) result.border = border;
  }
  if (merged.alignment != null) {
    if (typeof merged.alignment !== "object") throw new Error("style.alignment must be an object");
    const alignment = {};
    if (merged.alignment.horizontal != null) {
      const horizontal = String(merged.alignment.horizontal);
      if (!HORIZONTAL_ALIGNMENTS.has(horizontal)) throw new Error("style.alignment.horizontal is not supported");
      alignment.horizontal = horizontal;
    }
    if (merged.alignment.vertical != null) {
      const vertical = String(merged.alignment.vertical);
      if (!VERTICAL_ALIGNMENTS.has(vertical)) throw new Error("style.alignment.vertical is not supported");
      alignment.vertical = vertical;
    }
    if (merged.alignment.wrapText != null) {
      if (typeof merged.alignment.wrapText !== "boolean") throw new Error("style.alignment.wrapText must be boolean");
      if (merged.alignment.wrapText) alignment.wrapText = true;
    }
    if (Object.keys(alignment).length) result.alignment = alignment;
  }
  if (merged.numberFormat != null) {
    const numberFormat = String(merged.numberFormat).trim();
    if (!numberFormat || numberFormat.length > 120) throw new Error("style.numberFormat must be 1-120 characters");
    result.numberFormat = numberFormat;
  }
  return Object.keys(result).length ? result : null;
}

function stableEqual(left, right) {
  return JSON.stringify(left == null ? null : left) === JSON.stringify(right == null ? null : right);
}

function cellsEqual(left, right) {
  const a = left || null;
  const b = right || null;
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.v === b.v &&
    a.f === b.f &&
    a.t === b.t &&
    Boolean(a.formulaEvidence) === Boolean(b.formulaEvidence) &&
    (a.formulaType || null) === (b.formulaType || null) &&
    (a.formulaRef || null) === (b.formulaRef || null) &&
    (a.formulaGroupType || null) === (b.formulaGroupType || null) &&
    (a.formulaGroupRef || null) === (b.formulaGroupRef || null) &&
    stableEqual(a.style, b.style)
  );
}

function cellsContentEqual(left, right) {
  const clean = (cell) => {
    if (!cell) return null;
    const { style: _style, _sourceStyleIndex: _sourceStyleIndex, ...content } = cell;
    return Object.keys(content).length ? content : null;
  };
  return stableEqual(clean(left), clean(right));
}

function cellHasFormulaEvidence(cell) {
  return Boolean(
    cell &&
      (cell.formulaEvidence === true ||
        (typeof cell.f === "string" && cell.f.length > 0))
  );
}

function assertWorkbookWithinLimits(workbook) {
  if (!workbook || !Array.isArray(workbook.sheets) || workbook.sheets.length === 0) {
    throw new Error("Workbook must contain at least one worksheet");
  }
  let workbookCellCount = 0;
  for (const sheet of workbook.sheets) {
    assertSheetDimensions(Number(sheet.rows), Number(sheet.cols), `Worksheet ${sheet.name || sheet.id}`);
    for (const key of Object.keys(sheet.cells || {})) {
      workbookCellCount += 1;
      if (workbookCellCount > MAX_WORKBOOK_CELLS) {
        throw new Error(
          `[WORKBOOK_CELL_LIMIT] Workbook contains more than ${MAX_WORKBOOK_CELLS} populated cell records.`
        );
      }
      const parts = key.split(",");
      if (parts.length !== 2) {
        throw new Error(`[EXCEL_CELL_LIMIT] Invalid workbook cell key: ${key}`);
      }
      const row = Number(parts[0]);
      const col = Number(parts[1]);
      assertCellCoordinates(row, col, `Workbook cell ${key}`);
    }
  }
  return workbook;
}

function requirePositiveSafeInteger(value, fallback, name) {
  const resolved = value == null ? fallback : Number(value);
  if (!Number.isSafeInteger(resolved) || resolved < 1) {
    throw new Error(`${name} must be a positive safe integer`);
  }
  return resolved;
}

function populatedCellCount(workbook) {
  return (workbook.sheets || []).reduce(
    (total, sheet) => total + Object.keys(sheet.cells || {}).length,
    0
  );
}

function assertCellMutationCapacity(workbook, changes) {
  let nextCount = populatedCellCount(workbook);
  for (const change of changes || []) {
    if (!change.before && change.after) nextCount += 1;
    if (change.before && !change.after) nextCount -= 1;
  }
  if (!Number.isSafeInteger(nextCount) || nextCount > MAX_WORKBOOK_CELLS) {
    throw new Error(
      `[WORKBOOK_CELL_LIMIT] Operation would exceed ${MAX_WORKBOOK_CELLS} populated workbook cells.`
    );
  }
}

function assertExpectedRevision(workbook, input, action) {
  const supplied = input.expectedRevision ?? input.baseRevision;
  if (supplied == null) {
    throw new Error(
      `[EXPECTED_REVISION_REQUIRED] ${action} requires expectedRevision so concurrent workbook changes cannot be overwritten.`
    );
  }
  const expected = Number(supplied);
  if (!Number.isSafeInteger(expected) || expected < 0) {
    throw new Error(`${action} expectedRevision must be a non-negative integer`);
  }
  if (expected !== workbook.revision) {
    throw new Error(
      `[REVISION_CONFLICT] ${action} expected revision ${expected}, but the workbook is at revision ${workbook.revision}. Refresh and retry.`
    );
  }
}

function canonicalPathIdentity(value) {
  const resolved = path.resolve(String(value || ""));
  const missing = [];
  let cursor = resolved;
  while (!fs.existsSync(cursor)) {
    const parent = path.dirname(cursor);
    if (parent === cursor) break;
    missing.unshift(path.basename(cursor));
    cursor = parent;
  }
  let canonicalBase = cursor;
  try {
    canonicalBase = fs.realpathSync.native(cursor);
  } catch (_error) {
    canonicalBase = path.resolve(cursor);
  }
  const canonical = path.resolve(canonicalBase, ...missing);
  return process.platform === "win32" ? canonical.toLowerCase() : canonical;
}

function pathsReferToSameFile(left, right) {
  if (!left || !right) return false;
  const leftPath = path.resolve(String(left));
  const rightPath = path.resolve(String(right));
  if (canonicalPathIdentity(leftPath) === canonicalPathIdentity(rightPath)) return true;
  if (!fs.existsSync(leftPath) || !fs.existsSync(rightPath)) return false;
  try {
    const leftStat = fs.statSync(leftPath, { bigint: true });
    const rightStat = fs.statSync(rightPath, { bigint: true });
    return leftStat.dev === rightStat.dev && leftStat.ino === rightStat.ino;
  } catch (_error) {
    return false;
  }
}

function assertWritable(workbook, action) {
  if (workbook.mode === "inspect") {
    throw new Error(
      `[INSPECT_MODE_READ_ONLY] ${action} is not allowed while the workbook is in Inspect mode. Switch to Edit or Author mode first.`
    );
  }
}

function formulaCount(workbook) {
  let count = 0;
  for (const sheet of workbook.sheets || []) {
    for (const cell of Object.values(sheet.cells || {})) {
      if (cellHasFormulaEvidence(cell)) count += 1;
    }
  }
  return count;
}

function reconcileCalculationStatus(workbook) {
  const count = formulaCount(workbook);
  if (count === 0) {
    workbook.calculationStatus = {
      engine: "none",
      status: "not-required",
      formulaCount: 0,
      lastCalculatedRevision: null,
      warning: null,
    };
    return workbook.calculationStatus;
  }
  const previous = workbook.calculationStatus && typeof workbook.calculationStatus === "object"
    ? workbook.calculationStatus
    : {};
  const previousStatus = String(previous.status || "").toLowerCase();
  workbook.calculationStatus = {
    ...previous,
    engine: "none",
    status: workbook.dirty || previousStatus === "stale" ? "stale" : "cached",
    formulaCount: count,
    lastCalculatedRevision: null,
    warning: "Formula results are cached values; this engine does not recalculate formulas.",
  };
  return workbook.calculationStatus;
}

function refreshCalculationStatus(workbook, contentChanged = false) {
  const count = formulaCount(workbook);
  const wasStale = String(workbook.calculationStatus?.status || "").toLowerCase() === "stale";
  workbook.calculationStatus = {
    engine: "none",
    status: count === 0 ? "not-required" : contentChanged || wasStale ? "stale" : "cached",
    formulaCount: count,
    lastCalculatedRevision: null,
    warning: count > 0
      ? "Formula results are cached values; this engine does not recalculate formulas."
      : null,
  };
}

function operationAudit(operation, action, targetOperationId = null) {
  return {
    id: operation.id,
    type: action || operation.type,
    actor: operation.actor,
    intent: operation.intent || null,
    summary: operation.summary || null,
    sheetId: operation.sheetId || null,
    a1: operation.a1 || null,
    cellCount: operation.cellCount || 0,
    baseRevision: operation.baseRevision,
    revision: operation.revision,
    targetOperationId,
    createdAt: operation.createdAt,
  };
}

function appendHistory(workbook, entry) {
  workbook.history.push(entry);
  if (workbook.history.length > MAX_HISTORY) {
    workbook.history.splice(0, workbook.history.length - MAX_HISTORY);
  }
}

function recordOperation(workbook, descriptor) {
  const baseRevision = workbook.revision;
  const invalidatesSourceRoundTrip =
    descriptor.roundTripSafe === false &&
    Boolean(workbook.sourcePath) &&
    ["xlsx", "xlsm"].includes(String(workbook.sourceFormat || "").toLowerCase());
  const fidelityBefore = invalidatesSourceRoundTrip
    ? cloneJson(workbook.fidelity)
    : null;
  workbook.revision += 1;
  const operation = {
    id: newId("op"),
    type: descriptor.type,
    actor: descriptor.actor || "user",
    intent: descriptor.intent || null,
    summary: descriptor.summary || null,
    sheetId: descriptor.sheetId || null,
    a1: descriptor.a1 || null,
    cellCount: descriptor.cellCount || 0,
    baseRevision,
    revision: workbook.revision,
    createdAt: nowIso(),
    roundTripSafe: descriptor.roundTripSafe !== false,
    contentChanged: descriptor.contentChanged !== false,
    change: descriptor.change,
  };
  workbook.undoStack.push(operation);
  if (workbook.undoStack.length > MAX_UNDO_STACK) {
    workbook.undoStack.splice(0, workbook.undoStack.length - MAX_UNDO_STACK);
  }
  workbook.redoStack = [];
  appendHistory(workbook, operationAudit(operation));
  workbook.dirty = true;
  if (invalidatesSourceRoundTrip && workbook.fidelity) {
    workbook.fidelity.canRoundTrip = false;
    if (descriptor.structureChanged !== false) workbook.fidelity.structureChanged = true;
    workbook.fidelity.warning = descriptor.fidelityWarning ||
      "Workbook structure changed and cannot be patched into the source package losslessly. Export requires explicit fidelity-loss acknowledgement.";
    operation.fidelityBefore = fidelityBefore;
    operation.fidelityAfter = cloneJson(workbook.fidelity);
  }
  refreshCalculationStatus(workbook, operation.contentChanged);
  return operation;
}

function setSheetCell(sheet, row, col, cell) {
  assertCellCoordinates(row, col, "Worksheet cell");
  const key = cellKey(row, col);
  if (!cell) {
    delete sheet.cells[key];
    return;
  }
  if (row >= sheet.rows) sheet.rows = row + 1;
  if (col >= sheet.cols) sheet.cols = col + 1;
  sheet.cells[key] = cloneCell(cell);
}

function captureWorkbookContent(workbook) {
  return cloneJson({
    title: workbook.title,
    sheets: workbook.sheets,
    activeSheetId: workbook.activeSheetId,
    focus: workbook.focus,
    path: workbook.path,
    sourcePath: workbook.sourcePath,
    sourceFormat: workbook.sourceFormat,
    sourceFingerprint: workbook.sourceFingerprint,
    fidelity: workbook.fidelity,
  });
}

function restoreWorkbookContent(workbook, state) {
  workbook.title = state.title;
  workbook.sheets = cloneJson(state.sheets);
  workbook.activeSheetId = state.activeSheetId;
  workbook.focus = cloneJson(state.focus);
  if (Object.prototype.hasOwnProperty.call(state, "path")) workbook.path = state.path;
  if (Object.prototype.hasOwnProperty.call(state, "sourcePath")) workbook.sourcePath = state.sourcePath;
  if (Object.prototype.hasOwnProperty.call(state, "sourceFormat")) workbook.sourceFormat = state.sourceFormat;
  if (Object.prototype.hasOwnProperty.call(state, "sourceFingerprint")) {
    workbook.sourceFingerprint = cloneJson(state.sourceFingerprint);
  }
  if (state.fidelity) workbook.fidelity = cloneJson(state.fidelity);
}

function applyOperationChange(workbook, operation, direction) {
  const change = operation.change || {};
  const useAfter = direction === "after";
  if (change.kind === "cells") {
    const sheet = getSheet(workbook, change.sheetId);
    for (const cell of change.cells || []) {
      setSheetCell(sheet, cell.r, cell.c, useAfter ? cell.after : cell.before);
    }
    const size = useAfter ? change.afterSize : change.beforeSize;
    if (size) {
      sheet.rows = size.rows;
      sheet.cols = size.cols;
    }
    return;
  }
  if (change.kind === "sheet") {
    const snapshot = cloneJson(useAfter ? change.after : change.before);
    const index = workbook.sheets.findIndex((sheet) => sheet.id === change.sheetId);
    if (index < 0) throw new Error(`Cannot restore missing sheet: ${change.sheetId}`);
    workbook.sheets[index] = snapshot;
    return;
  }
  if (change.kind === "sheet-name") {
    getSheet(workbook, change.sheetId).name = useAfter ? change.after : change.before;
    return;
  }
  if (change.kind === "layout") {
    getSheet(workbook, change.sheetId).layout = cloneJson(useAfter ? change.after : change.before);
    return;
  }
  if (change.kind === "compound") {
    for (const part of change.changes || []) {
      applyOperationChange(workbook, { change: part }, direction);
    }
    return;
  }
  if (change.kind === "workbook") {
    restoreWorkbookContent(workbook, useAfter ? change.after : change.before);
    return;
  }
  throw new Error(`Unsupported reversible operation kind: ${change.kind || "unknown"}`);
}

function undo(input = {}) {
  const workspacePath = requireWorkspace(input);
  const workbookId = requireWorkbookId(input);
  const workbook = loadOrGet(workspacePath, workbookId);
  assertWritable(workbook, "undo");
  assertExpectedRevision(workbook, input, "undo");
  const target = workbook.undoStack[workbook.undoStack.length - 1];
  if (!target) {
    return { summary: "Nothing to undo", operation: null, meta: metaOf(workbook) };
  }
  applyOperationChange(workbook, target, "before");
  if (target.fidelityBefore) workbook.fidelity = cloneJson(target.fidelityBefore);
  workbook.undoStack.pop();
  workbook.proposal = null;
  const baseRevision = workbook.revision;
  workbook.revision += 1;
  workbook.redoStack.push(target);
  const audit = {
    id: newId("op"),
    type: "undo",
    actor: input.actor || "user",
    intent: input.intent || `Undo ${target.type}`,
    summary: `Undid ${target.type}`,
    sheetId: target.sheetId || null,
    a1: target.a1 || null,
    cellCount: target.cellCount || 0,
    baseRevision,
    revision: workbook.revision,
    createdAt: nowIso(),
  };
  appendHistory(workbook, operationAudit(audit, "undo", target.id));
  workbook.dirty = true;
  refreshCalculationStatus(workbook, target.contentChanged !== false);
  const saved = persist(workspacePath, workbook);
  return { summary: audit.summary, operation: operationAudit(audit, "undo", target.id), meta: metaOf(saved) };
}

function redo(input = {}) {
  const workspacePath = requireWorkspace(input);
  const workbookId = requireWorkbookId(input);
  const workbook = loadOrGet(workspacePath, workbookId);
  assertWritable(workbook, "redo");
  assertExpectedRevision(workbook, input, "redo");
  const target = workbook.redoStack[workbook.redoStack.length - 1];
  if (!target) {
    return { summary: "Nothing to redo", operation: null, meta: metaOf(workbook) };
  }
  applyOperationChange(workbook, target, "after");
  if (target.fidelityAfter) workbook.fidelity = cloneJson(target.fidelityAfter);
  workbook.redoStack.pop();
  workbook.proposal = null;
  const baseRevision = workbook.revision;
  workbook.revision += 1;
  workbook.undoStack.push(target);
  const audit = {
    id: newId("op"),
    type: "redo",
    actor: input.actor || "user",
    intent: input.intent || `Redo ${target.type}`,
    summary: `Redid ${target.type}`,
    sheetId: target.sheetId || null,
    a1: target.a1 || null,
    cellCount: target.cellCount || 0,
    baseRevision,
    revision: workbook.revision,
    createdAt: nowIso(),
  };
  appendHistory(workbook, operationAudit(audit, "redo", target.id));
  workbook.dirty = true;
  refreshCalculationStatus(workbook, target.contentChanged !== false);
  const saved = persist(workspacePath, workbook);
  return { summary: audit.summary, operation: operationAudit(audit, "redo", target.id), meta: metaOf(saved) };
}

function getHistory(input = {}) {
  const workspacePath = requireWorkspace(input);
  const workbookId = requireWorkbookId(input);
  const workbook = loadOrGet(workspacePath, workbookId);
  const requested = input.limit == null ? 50 : Number(input.limit);
  const limit = Math.max(1, Math.min(200, Number.isFinite(requested) ? Math.floor(requested) : 50));
  const history = workbook.history.slice(-limit).reverse();
  return {
    summary: `${history.length} operation(s), revision ${workbook.revision}`,
    revision: workbook.revision,
    canUndo: workbook.undoStack.length > 0,
    canRedo: workbook.redoStack.length > 0,
    history,
    entries: history,
  };
}

function getSession(workbookId) {
  const session = sessions.get(workbookId);
  if (!session) {
    throw new Error(
      `Workbook session not found: ${workbookId}. Open or create a workbook first.`
    );
  }
  return session;
}

function loadOrGet(workspacePath, workbookId) {
  if (sessions.has(workbookId)) {
    const session = sessions.get(workbookId);
    if (session.workspacePath === workspacePath) {
      return assertWorkbookWithinLimits(session.workbook);
    }
  }
  const workbook = assertWorkbookWithinLimits(loadJson(workspacePath, workbookId));
  reconcileCalculationStatus(workbook);
  sessions.set(workbookId, { workspacePath, workbook });
  return workbook;
}

function resolveSheet(workbook, sheetId, a1Ref) {
  let qualifiedSheet = null;
  if (a1Ref) {
    const parsed = parseA1(a1Ref);
    if (parsed.sheet) {
      qualifiedSheet = findSheetByName(workbook, parsed.sheet)
        || workbook.sheets.find((sheet) => sheet.id === parsed.sheet)
        || null;
      if (!qualifiedSheet) throw new Error(`Sheet not found: ${parsed.sheet}`);
    }
  }
  if (sheetId) {
    const explicitSheet = getSheet(workbook, sheetId);
    if (qualifiedSheet && qualifiedSheet.id !== explicitSheet.id) {
      throw new Error(
        `[SHEET_QUALIFIER_CONFLICT] sheetId targets ${explicitSheet.name}, but a1 targets ${qualifiedSheet.name}. Use one consistent sheet target.`
      );
    }
    return explicitSheet;
  }
  if (qualifiedSheet) return qualifiedSheet;
  return getSheet(workbook, workbook.activeSheetId);
}

function resolveRange(workbook, input = {}) {
  const sheet = resolveSheet(workbook, input.sheetId, input.a1);
  let range;
  if (input.a1) {
    range = parseA1(input.a1);
  } else if (workbook.focus && workbook.focus.sheetId === sheet.id && workbook.focus.a1) {
    range = parseA1(workbook.focus.a1);
  } else {
    range = { sheet: null, r1: 0, c1: 0, r2: 0, c2: 0 };
  }
  range = clampRange(range, sheet.rows, sheet.cols);
  return { sheet, range, a1: formatA1(range.r1, range.c1, range.r2, range.c2) };
}

function cellDisplay(cell) {
  if (!cell) return null;
  const result = cellHasFormulaEvidence(cell)
    ? {
      v: cell.v != null ? cell.v : null,
      f: typeof cell.f === "string" && cell.f ? cell.f : null,
      t: cell.t || "f",
      formulaEvidence: true,
      formulaType: cell.formulaType || cell.formulaGroupType || null,
      formulaRef: cell.formulaRef || cell.formulaGroupRef || null,
    }
    : {
      v: cell.v != null ? cell.v : null,
      t: cell.t || (typeof cell.v === "number" ? "n" : "s"),
    };
  if (cell.style) result.style = cloneJson(cell.style);
  return result;
}

function valueCell(value) {
  if (value === null || value === "") return {};
  if (typeof value === "number") return { v: value, t: "n" };
  if (typeof value === "boolean") return { v: value, t: "b" };
  const text = String(value);
  const num = Number(text);
  if (text.trim() !== "" && !Number.isNaN(num) && /^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(text.trim())) {
    return { v: num, t: "n" };
  }
  return { v: text, t: "s" };
}

function cellFromPatch(before, patch) {
  const previous = cloneCell(before) || {};
  let next = cloneCell(before) || {};
  const hasFormula = Object.prototype.hasOwnProperty.call(patch, "formula") && patch.formula != null;
  const hasValue = Object.prototype.hasOwnProperty.call(patch, "value") && patch.value !== undefined;
  if (hasFormula) {
    let f = String(patch.formula).trim();
    if (f.startsWith("=")) f = f.slice(1);
    next = { f, t: "f", formulaEvidence: true };
    if (hasValue) next.v = patch.value;
  } else if (hasValue) {
    next = valueCell(patch.value);
  }
  const style = normalizeStyle(patch.style, patch.styleRole, previous.style || null);
  if (style) next.style = style;
  else delete next.style;
  if (previous._sourceStyleIndex != null) next._sourceStyleIndex = previous._sourceStyleIndex;
  const publicKeys = Object.keys(next).filter((key) => key !== "_sourceStyleIndex");
  return publicKeys.length ? next : null;
}

function setCell(sheet, row, col, patch) {
  assertCellCoordinates(row, col, "Worksheet cell");
  if (row >= sheet.rows) sheet.rows = row + 1;
  if (col >= sheet.cols) sheet.cols = col + 1;
  const key = cellKey(row, col);
  const next = cellFromPatch(sheet.cells[key] || null, patch);
  setSheetCell(sheet, row, col, next);
  return next;
}

function metaOf(workbook) {
  reconcileCalculationStatus(workbook);
  const count = formulaCount(workbook);
  return {
    workbookId: workbook.workbookId,
    title: workbook.title,
    path: workbook.path,
    sourcePath: workbook.sourcePath || null,
    sourceFormat: workbook.sourceFormat || null,
    sourceFingerprint: cloneJson(workbook.sourceFingerprint),
    lastExportPath: workbook.lastExportPath || null,
    lastExportedRevision: Number.isSafeInteger(workbook.lastExportedRevision)
      ? workbook.lastExportedRevision
      : null,
    dirty: Boolean(workbook.dirty),
    revision: workbook.revision,
    mode: workbook.mode,
    activeSheetId: workbook.activeSheetId,
    sheetCount: workbook.sheets.length,
    sheets: workbook.sheets.map((s) => ({
      id: s.id,
      name: s.name,
      rows: s.rows,
      cols: s.cols,
      cellCount: Object.keys(s.cells || {}).length,
      layout: cloneJson(s.layout),
    })),
    focus: workbook.focus,
    hasProposal: Boolean(workbook.proposal),
    proposalId: workbook.proposal ? workbook.proposal.id : null,
    proposalBaseRevision: workbook.proposal ? workbook.proposal.baseRevision : null,
    capabilities: {
      revisionedEdits: true,
      undoRedo: true,
      canUndo: workbook.undoStack.length > 0,
      canRedo: workbook.redoStack.length > 0,
      history: true,
      partialProposalAccept: true,
      localPatch: true,
      inspectModeEnforced: true,
      atomicStoreWrites: true,
      sourceOverwriteProtected: true,
      formulaRecalculation: false,
      formulaStaticLint: true,
      cellStyles: true,
      semanticStyleRoles: Object.keys(STYLE_ROLES),
      numberFormats: true,
      layoutMetadata: true,
      styleInterpretation: "basic-rgb-font-fill-border-alignment-number-format",
      unsupportedStyleInterpretation: ["theme colors", "indexed colors", "conditional formatting", "named styles"],
      styleSourcePatch: !workbook.sourcePath,
      layoutSourcePatch: !workbook.sourcePath,
      sourcePreservingStylePatch: !workbook.sourcePath,
      sourcePreservingLayoutPatch: !workbook.sourcePath,
      losslessRoundTrip: Boolean(workbook.fidelity?.canRoundTrip),
      structuralEditsAllowed: count === 0 && workbook.mode !== "inspect",
    },
    fidelity: cloneJson(workbook.fidelity),
    calculationStatus: cloneJson(workbook.calculationStatus),
    createdAt: workbook.createdAt,
    updatedAt: workbook.updatedAt,
  };
}

function viewportSummary(workbook, sheet, maxRows = 20, maxCols = 10) {
  const r2 = Math.min(sheet.rows - 1, maxRows - 1);
  const c2 = Math.min(sheet.cols - 1, maxCols - 1);
  const values = [];
  for (let r = 0; r <= r2; r += 1) {
    const row = [];
    for (let c = 0; c <= c2; c += 1) {
      const cell = sheet.cells[cellKey(r, c)];
      row.push(cell && cell.v != null ? cell.v : cell && cell.f ? `=${cell.f}` : "");
    }
    values.push(row);
  }
  return {
    sheetId: sheet.id,
    sheetName: sheet.name,
    a1: formatA1(0, 0, r2, c2),
    values,
  };
}

function proposalSummary(proposal) {
  if (!proposal) return null;
  return {
    id: proposal.id,
    sheetId: proposal.sheetId,
    a1: proposal.a1,
    cellCount: (proposal.cells || []).length,
    baseRevision: proposal.baseRevision,
    intent: proposal.intent || null,
    validation: cloneJson(proposal.validation),
    layout: cloneJson(proposal.layout),
    createdAt: proposal.createdAt,
  };
}

function proposalCellResult(proposal, resultCellLimit) {
  const source = proposal?.cells || [];
  let limit = source.length;
  if (resultCellLimit != null) {
    limit = Number(resultCellLimit);
    if (!Number.isSafeInteger(limit) || limit < 0 || limit > MAX_PROPOSAL_CELLS) {
      throw new Error(`resultCellLimit must be a safe integer between 0 and ${MAX_PROPOSAL_CELLS}`);
    }
  }
  const selected = source.slice(0, limit).map((cell) => ({
    row: cell.r,
    col: cell.c,
    a1: formatA1(cell.r, cell.c),
    before: cellDisplay(cell.before),
    after: cellDisplay(cell.after),
  }));
  return {
    cells: selected,
    totalCellCount: source.length,
    cellDetailsTruncated: selected.length < source.length,
  };
}

function proposalRange(cells) {
  let r1 = Infinity;
  let c1 = Infinity;
  let r2 = -Infinity;
  let c2 = -Infinity;
  for (const cell of cells || []) {
    r1 = Math.min(r1, cell.r);
    c1 = Math.min(c1, cell.c);
    r2 = Math.max(r2, cell.r);
    c2 = Math.max(c2, cell.c);
  }
  return Number.isFinite(r1) ? formatA1(r1, c1, r2, c2) : null;
}

function validateLayoutBands(items, sizeKey, maximum, label) {
  if (!Array.isArray(items)) throw new Error(`layout.${label} must be an array`);
  if (items.length > MAX_LAYOUT_BANDS) throw new Error(`layout.${label} cannot exceed ${MAX_LAYOUT_BANDS} bands`);
  let covered = 0;
  for (const item of items) {
    if (!item || typeof item !== "object") throw new Error(`layout.${label} entries must be objects`);
    const start = Number(item.start);
    const end = item.end == null ? start : Number(item.end);
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || end >= maximum) {
      throw new Error(`layout.${label} start/end must be 0-based inclusive indexes within the current or proposed sheet dimensions`);
    }
    if (item[sizeKey] == null && item.autoFit !== true) {
      throw new Error(`layout.${label} entries require ${sizeKey} or autoFit=true`);
    }
    if (item[sizeKey] != null) {
      const size = Number(item[sizeKey]);
      const upper = sizeKey === "width" ? 255 : 409;
      if (!Number.isFinite(size) || size <= 0 || size > upper) {
        throw new Error(`layout.${label}.${sizeKey} must be greater than 0 and at most ${upper}`);
      }
    }
    covered += end - start + 1;
    if (label === "rows" && covered > MAX_CUSTOM_LAYOUT_ROWS) {
      throw new Error(`layout.rows cannot materialize more than ${MAX_CUSTOM_LAYOUT_ROWS} custom-height rows`);
    }
  }
}

function mergeLayoutBands(current, changes, sizeKey) {
  let result = cloneJson(current) || [];
  for (const change of changes) {
    const start = Number(change.start);
    const end = change.end == null ? start : Number(change.end);
    const preserved = [];
    for (const existing of result) {
      if (existing.end < start || existing.start > end) {
        preserved.push(existing);
        continue;
      }
      if (existing.start < start) preserved.push({ ...existing, end: start - 1 });
      if (existing.end > end) preserved.push({ ...existing, start: end + 1 });
    }
    const next = { start, end };
    if (change[sizeKey] != null) next[sizeKey] = Number(change[sizeKey]);
    if (change.autoFit === true) next.autoFit = true;
    result = [...preserved, next];
  }
  return result.sort((a, b) => a.start - b.start || a.end - b.end);
}

function displayWidth(value) {
  let width = 0;
  for (const character of String(value == null ? "" : value)) {
    width += character.codePointAt(0) > 255 ? 2 : 1;
  }
  return width;
}

function autoFitColumnWidth(sheet, start, end, pendingCells) {
  const pending = new Map((pendingCells || []).map((cell) => [`${cell.r},${cell.c}`, cell.after]));
  let longest = 0;
  const keys = new Set([...Object.keys(sheet.cells || {}), ...pending.keys()]);
  for (const key of keys) {
    const [row, col] = key.split(",").map(Number);
    if (col < start || col > end) continue;
    const cell = pending.has(key) ? pending.get(key) : sheet.cells[key];
    const display = cell?.v != null ? cell.v : cell?.f ? `=${cell.f}` : "";
    for (const line of String(display).split(/\r?\n/)) longest = Math.max(longest, displayWidth(line));
  }
  return Math.max(10, Math.min(60, longest ? longest + 2 : 18));
}

function autoFitRowHeight(sheet, start, end, pendingCells) {
  const pending = new Map((pendingCells || []).map((cell) => [`${cell.r},${cell.c}`, cell.after]));
  let lines = 1;
  const keys = new Set([...Object.keys(sheet.cells || {}), ...pending.keys()]);
  for (const key of keys) {
    const [row] = key.split(",").map(Number);
    if (row < start || row > end) continue;
    const cell = pending.has(key) ? pending.get(key) : sheet.cells[key];
    const display = cell?.v != null ? cell.v : cell?.f ? `=${cell.f}` : "";
    lines = Math.max(lines, String(display).split(/\r?\n/).length);
  }
  return Math.max(24, Math.min(120, lines * 15));
}

function layoutFromPatch(sheet, patch, pendingCells = []) {
  if (patch == null) return null;
  if (typeof patch !== "object" || Array.isArray(patch)) throw new Error("layout must be an object");
  const before = normalizeSheetLayout(sheet.layout);
  const next = cloneJson(before);
  const projectedRows = Math.max(sheet.rows, ...pendingCells.map((cell) => cell.r + 1));
  const projectedColumns = Math.max(sheet.cols, ...pendingCells.map((cell) => cell.c + 1));
  if (Object.prototype.hasOwnProperty.call(patch, "columns")) {
    validateLayoutBands(patch.columns, "width", projectedColumns, "columns");
    const columns = patch.columns.map((item) => ({
      ...item,
      width: item.width == null && item.autoFit === true
        ? autoFitColumnWidth(sheet, Number(item.start), Number(item.end == null ? item.start : item.end), pendingCells)
        : item.width,
    }));
    next.columns = columns.length === 0 ? [] : mergeLayoutBands(next.columns, columns, "width");
  }
  if (Object.prototype.hasOwnProperty.call(patch, "rows")) {
    validateLayoutBands(patch.rows, "height", projectedRows, "rows");
    const rows = patch.rows.map((item) => ({
      ...item,
      height: item.height == null && item.autoFit === true
        ? autoFitRowHeight(sheet, Number(item.start), Number(item.end == null ? item.start : item.end), pendingCells)
        : item.height,
    }));
    next.rows = rows.length === 0 ? [] : mergeLayoutBands(next.rows, rows, "height");
  }
  if (Object.prototype.hasOwnProperty.call(patch, "freezePanes")) {
    if (!patch.freezePanes || typeof patch.freezePanes !== "object") {
      throw new Error("layout.freezePanes must be an object");
    }
    const rows = patch.freezePanes.rows == null ? next.freezePanes.rows : Number(patch.freezePanes.rows);
    const columns = patch.freezePanes.columns == null ? next.freezePanes.columns : Number(patch.freezePanes.columns);
    if (!Number.isSafeInteger(rows) || rows < 0 || rows >= projectedRows) {
      throw new Error(`layout.freezePanes.rows must be a non-negative safe integer smaller than the projected sheet row count (${projectedRows})`);
    }
    if (!Number.isSafeInteger(columns) || columns < 0 || columns >= projectedColumns) {
      throw new Error(`layout.freezePanes.columns must be a non-negative safe integer smaller than the projected sheet column count (${projectedColumns})`);
    }
    next.freezePanes = { rows, columns };
  }
  if (Object.prototype.hasOwnProperty.call(patch, "autoFilter")) {
    if (patch.autoFilter == null) {
      next.autoFilter = null;
    } else if (typeof patch.autoFilter === "object" && typeof patch.autoFilter.a1 === "string") {
      const parsed = parseA1(patch.autoFilter.a1);
      if (parsed.sheet) {
        const token = String(parsed.sheet).toLowerCase();
        if (token !== String(sheet.id).toLowerCase() && token !== String(sheet.name).toLowerCase()) {
          throw new Error(`layout.autoFilter.a1 targets another sheet: ${parsed.sheet}`);
        }
      }
      next.autoFilter = { a1: formatA1(parsed.r1, parsed.c1, parsed.r2, parsed.c2) };
    } else {
      throw new Error("layout.autoFilter must be null or {a1}");
    }
  }
  return { before, after: normalizeSheetLayout(next) };
}

function cellChangesStyle(cells) {
  return (cells || []).some((cell) => !stableEqual(cell.before?.style, cell.after?.style));
}

function cellChangesContent(cells) {
  return (cells || []).some((cell) => !cellsContentEqual(cell.before, cell.after));
}

function lintFormula(formula, row, col) {
  const cell = formatA1(row, col);
  const text = String(formula == null ? "" : formula).replace(/^=/, "").trim();
  const errors = [];
  const warnings = [];
  if (!text) {
    errors.push({ code: "FORMULA_EMPTY", cell, message: `${cell} has an empty formula.` });
    return { errors, warnings };
  }
  let depth = 0;
  let inString = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === '"') {
      if (inString && text[index + 1] === '"') {
        index += 1;
      } else {
        inString = !inString;
      }
      continue;
    }
    if (inString) continue;
    if (character === "(") depth += 1;
    if (character === ")") depth -= 1;
    if (depth < 0) break;
  }
  if (inString) {
    errors.push({ code: "FORMULA_QUOTE_UNBALANCED", cell, message: `${cell} has an unbalanced string quote.` });
  }
  if (depth !== 0) {
    errors.push({ code: "FORMULA_PAREN_UNBALANCED", cell, message: `${cell} has unbalanced parentheses.` });
  }
  const normalizedSelf = cell.toUpperCase();
  const references = text.match(/(?<![A-Z0-9_])\$?([A-Z]{1,3})\$?([1-9]\d*)(?![A-Z0-9_])/gi) || [];
  if (references.some((reference) => reference.replaceAll("$", "").toUpperCase() === normalizedSelf)) {
    errors.push({ code: "FORMULA_SELF_REFERENCE", cell, message: `${cell} directly references itself and creates an obvious circular reference.` });
  }
  if (/\[[^\]]+\]|(?:https?|ftp):\/\/|\\\\|\b(?:WEBSERVICE|FILTERXML|RTD)\s*\(/i.test(text)) {
    warnings.push({ code: "FORMULA_EXTERNAL_LINK", cell, message: `${cell} contains an external-link or external-data pattern. Review trust and portability before accepting.` });
  }
  return { errors, warnings };
}

function lintPatchFormulas(cells) {
  const errors = [];
  const warnings = [];
  let checkedFormulaCount = 0;
  for (const cell of cells || []) {
    if (!cellHasFormulaEvidence(cell.after)) continue;
    if (cellHasFormulaEvidence(cell.before) && cell.before.f === cell.after.f) continue;
    checkedFormulaCount += 1;
    const result = lintFormula(cell.after.f, cell.r, cell.c);
    errors.push(...result.errors);
    warnings.push(...result.warnings);
  }
  return {
    status: errors.length > 0 ? "invalid" : warnings.length > 0 ? "warning" : "valid",
    checkedFormulaCount,
    recalculated: false,
    calculationEngine: "none",
    note: checkedFormulaCount > 0
      ? "Static syntax and risk checks only; formulas were not calculated and cached results were not verified."
      : "No new or changed formulas in this patch; no calculation was performed.",
    errors,
    warnings,
  };
}

function validatePatchCells(sheet, cells) {
  const seen = new Set();
  const errors = [];
  const warnings = [];
  let overwriteCount = 0;
  let formulaCountAfter = 0;
  let noOpCount = 0;
  for (const cell of cells || []) {
    const key = cellKey(cell.r, cell.c);
    if (seen.has(key)) {
      errors.push(`Duplicate cell ${formatA1(cell.r, cell.c)}`);
    }
    seen.add(key);
    if (cell.before && !cellsEqual(cell.before, cell.after)) overwriteCount += 1;
    if (cellHasFormulaEvidence(cell.after)) formulaCountAfter += 1;
    if (cellsEqual(cell.before, cell.after)) noOpCount += 1;
  }
  if (overwriteCount > 0) warnings.push(`${overwriteCount} non-empty cell(s) will be overwritten.`);
  if (formulaCountAfter > 0) {
    warnings.push(`${formulaCountAfter} formula cell(s) cannot be recalculated by this engine.`);
  }
  const formulaLint = lintPatchFormulas(cells);
  errors.push(...formulaLint.errors.map((issue) => `${issue.code} ${issue.message}`));
  warnings.push(...formulaLint.warnings.map((issue) => `${issue.code} ${issue.message}`));
  if (noOpCount > 0) warnings.push(`${noOpCount} cell(s) already match the proposal.`);
  return {
    status: errors.length > 0 ? "invalid" : warnings.length > 0 ? "warning" : "valid",
    checkedAt: nowIso(),
    cellCount: (cells || []).length,
    overwriteCount,
    formulaCount: formulaCountAfter,
    noOpCount,
    errors,
    warnings,
    formulaLint,
  };
}

function rebaseProposal(workbook, excluded = new Set(), layoutAccepted = false) {
  const proposal = workbook.proposal;
  if (!proposal) return;
  const sheet = getSheet(workbook, proposal.sheetId);
  const remaining = (proposal.cells || []).filter(
    (cell) => !excluded.has(`${proposal.sheetId}:${cell.r},${cell.c}`)
  );
  if (layoutAccepted) proposal.layout = null;
  if (proposal.layout && !stableEqual(sheet.layout, proposal.layout.before)) {
    workbook.proposal = null;
    return;
  }
  if (remaining.length === 0 && !proposal.layout) {
    workbook.proposal = null;
    return;
  }
  const conflicts = remaining.filter(
    (cell) => !cellsEqual(sheet.cells[cellKey(cell.r, cell.c)] || null, cell.before)
  );
  if (conflicts.length > 0) {
    workbook.proposal = null;
    return;
  }
  proposal.cells = remaining;
  proposal.a1 = proposalRange(remaining);
  proposal.baseRevision = workbook.revision;
  proposal.validation = validatePatchCells(sheet, remaining);
  proposal.validation.layoutChanged = Boolean(proposal.layout);
  proposal.validation.layoutPartialAccept = proposal.layout
    ? "Layout is applied only when the proposal is accepted without cellRefs."
    : null;
}

function clearProposalOverlap(workbook, sheetId, row, col) {
  if (!workbook.proposal) return;
  if (workbook.proposal.sheetId !== sheetId) return;
  const remaining = (workbook.proposal.cells || []).filter(
    (c) => !(c.r === row && c.c === col)
  );
  if (remaining.length === 0) {
    workbook.proposal = null;
  } else if (remaining.length !== workbook.proposal.cells.length) {
    workbook.proposal = { ...workbook.proposal, cells: remaining };
  }
}

function clearProposalIfOverlapsRange(workbook, sheetId, range) {
  if (!workbook.proposal) return;
  if (workbook.proposal.sheetId !== sheetId) return;
  const hits = (workbook.proposal.cells || []).some(
    (c) => c.r >= range.r1 && c.r <= range.r2 && c.c >= range.c1 && c.c <= range.c2
  );
  if (hits) {
    workbook.proposal = null;
  }
}

function openWorkbook(input = {}) {
  const workspacePath = requireWorkspace(input);
  if (!input.path || typeof input.path !== "string") {
    throw new Error("path is required to open a workbook");
  }
  const filePath = resolveConsumerPath(input, workspacePath, input.path, "openWorkbook");

  // Reuse the existing store id when this file was opened before so the
  // surface and agent keep pointing at one workbook per file.
  const requestedId = input.workbookId == null ? null : validateWorkbookId(input.workbookId);
  const foundId = findWorkbookIdByPath(workspacePath, filePath)
    || listWorkbookMetas(workspacePath).find((meta) =>
      pathsReferToSameFile(meta.sourcePath || meta.path, filePath)
    )?.workbookId
    || null;
  if (requestedId && foundId && requestedId !== foundId) {
    throw new Error(
      `[WORKBOOK_PATH_ALREADY_OPEN] ${filePath} already belongs to live workbook ${foundId}, not ${requestedId}. Resume the existing workbook or explicitly reload it.`
    );
  }
  const existingId = requestedId || foundId;

  if (existingId) {
    let existing = null;
    try {
      existing = loadOrGet(workspacePath, existingId);
    } catch (error) {
      if (!/^Workbook store not found:/.test(String(error.message || ""))) throw error;
      if (foundId || !requestedId) throw error;
    }
    if (existing) {
      const associatedPath = existing.sourcePath || existing.path;
      if (
        !associatedPath ||
        !pathsReferToSameFile(associatedPath, filePath)
      ) {
        throw new Error(
          `[WORKBOOK_ID_PATH_MISMATCH] Workbook ${existingId} is already associated with ${associatedPath || "an internal workbook"}, not ${filePath}.`
        );
      }
      const sheet = getSheet(existing, existing.activeSheetId);
      return {
        summary: `Resumed live workbook "${existing.title}" at revision ${existing.revision}; external source was not re-read. Use reloadWorkbook with expectedRevision to reload explicitly.`,
        resumed: true,
        meta: metaOf(existing),
        viewport: viewportSummary(existing, sheet),
      };
    }
  }

  const workbook = readWorkbookFile(filePath, {
    title: input.title,
    workbookId: requestedId || undefined,
  });
  ensureDir(workbookDir(workspacePath, workbook.workbookId));
  const saved = persist(workspacePath, workbook);
  const sheet = getSheet(saved, saved.activeSheetId);
  return {
    summary: `Opened workbook "${saved.title}" (${saved.sheets.length} sheet(s)) from ${filePath}`,
    resumed: false,
    meta: metaOf(saved),
    viewport: viewportSummary(saved, sheet),
  };
}

function createWorkbook(input = {}) {
  const workspacePath = requireWorkspace(input);
  const rows = requirePositiveSafeInteger(input.rows, 50, "rows");
  const cols = requirePositiveSafeInteger(input.cols, 26, "cols");
  assertSheetDimensions(rows, cols, "New worksheet");
  const workbook = createEmpty({
    title: input.title || "Untitled Workbook",
    rows,
    cols,
    sheetName: input.sheetName || "Sheet1",
  });
  ensureDir(workbookDir(workspacePath, workbook.workbookId));
  const saved = persist(workspacePath, workbook);
  const sheet = getSheet(saved, saved.activeSheetId);
  return {
    summary: `Created empty workbook "${saved.title}" (${sheet.rows}x${sheet.cols})`,
    meta: metaOf(saved),
    viewport: viewportSummary(saved, sheet),
  };
}

function getMeta(input = {}) {
  const workspacePath = requireWorkspace(input);
  const workbookId = requireWorkbookId(input);
  const workbook = loadOrGet(workspacePath, workbookId);
  return {
    summary: `Workbook "${workbook.title}" — ${workbook.sheets.length} sheet(s), dirty=${workbook.dirty}`,
    meta: metaOf(workbook),
  };
}

function listSheets(input = {}) {
  const workspacePath = requireWorkspace(input);
  const workbookId = requireWorkbookId(input);
  const workbook = loadOrGet(workspacePath, workbookId);
  return {
    summary: `${workbook.sheets.length} sheet(s) in "${workbook.title}"`,
    activeSheetId: workbook.activeSheetId,
    sheets: workbook.sheets.map((s) => ({
      id: s.id,
      name: s.name,
      rows: s.rows,
      cols: s.cols,
      cellCount: Object.keys(s.cells || {}).length,
      layout: cloneJson(s.layout),
    })),
  };
}

function switchSheet(input = {}) {
  const workspacePath = requireWorkspace(input);
  const workbookId = requireWorkbookId(input);
  const workbook = loadOrGet(workspacePath, workbookId);
  let sheet = null;
  if (input.sheetId) {
    sheet = getSheet(workbook, input.sheetId);
  } else if (input.sheetName) {
    sheet = findSheetByName(workbook, input.sheetName);
    if (!sheet) throw new Error(`Sheet not found: ${input.sheetName}`);
  } else {
    throw new Error("sheetId or sheetName is required");
  }
  workbook.activeSheetId = sheet.id;
  workbook.focus = {
    sheetId: sheet.id,
    a1: workbook.focus && workbook.focus.sheetId === sheet.id ? workbook.focus.a1 : "A1",
    kind: workbook.focus && workbook.focus.sheetId === sheet.id ? workbook.focus.kind : "cell",
  };
  const saved = persist(workspacePath, workbook);
  return {
    summary: `Switched to sheet "${sheet.name}"`,
    meta: metaOf(saved),
    viewport: viewportSummary(saved, sheet),
  };
}

function getFocus(input = {}) {
  const workspacePath = requireWorkspace(input);
  const workbookId = requireWorkbookId(input);
  const workbook = loadOrGet(workspacePath, workbookId);
  const sheet = getSheet(workbook, workbook.focus.sheetId);
  return {
    summary: `Focus ${sheet.name}!${workbook.focus.a1} (${workbook.focus.kind})`,
    focus: {
      ...workbook.focus,
      sheetName: sheet.name,
    },
    mode: workbook.mode,
    revision: workbook.revision,
  };
}

function setFocus(input = {}) {
  const workspacePath = requireWorkspace(input);
  const workbookId = requireWorkbookId(input);
  const workbook = loadOrGet(workspacePath, workbookId);
  if (!input.a1) {
    throw new Error("a1 is required for setFocus");
  }
  const sheet = resolveSheet(workbook, input.sheetId, input.a1);
  const range = clampRange(parseA1(input.a1), sheet.rows, sheet.cols);
  const a1 = formatA1(range.r1, range.c1, range.r2, range.c2);
  let kind = input.kind;
  if (!kind) {
    kind = range.r1 === range.r2 && range.c1 === range.c2 ? "cell" : "range";
  }
  if (input.mode != null) {
    if (!["inspect", "edit", "author"].includes(input.mode)) {
      throw new Error("mode must be one of: inspect, edit, author");
    }
    workbook.mode = normalizeMode(input.mode);
  }
  workbook.focus = { sheetId: sheet.id, a1, kind };
  workbook.activeSheetId = sheet.id;
  const saved = persist(workspacePath, workbook);
  return {
    summary: `Focus set to ${sheet.name}!${a1}`,
    focus: { ...saved.focus, sheetName: sheet.name },
    meta: metaOf(saved),
  };
}

function setMode(input = {}) {
  const workspacePath = requireWorkspace(input);
  const workbookId = requireWorkbookId(input);
  const workbook = loadOrGet(workspacePath, workbookId);
  if (!input.mode || !["inspect", "edit", "author"].includes(input.mode)) {
    throw new Error("mode must be one of: inspect, edit, author");
  }
  workbook.mode = normalizeMode(input.mode);
  const saved = persist(workspacePath, workbook);
  return {
    summary: `Workbook mode set to ${saved.mode}`,
    mode: saved.mode,
    meta: metaOf(saved),
  };
}

function readRange(input = {}) {
  const workspacePath = requireWorkspace(input);
  const workbookId = requireWorkbookId(input);
  const workbook = loadOrGet(workspacePath, workbookId);
  const maxCells = requirePositiveSafeInteger(input.maxCells, DEFAULT_MAX_CELLS, "maxCells");
  if (maxCells > MAX_READ_RANGE_CELLS) {
    throw new Error(`[READ_CELL_LIMIT] maxCells cannot exceed ${MAX_READ_RANGE_CELLS}.`);
  }
  const { sheet, range, a1 } = resolveRange(workbook, input);
  const count = cellCount(range.r1, range.c1, range.r2, range.c2);
  if (count > maxCells) {
    throw new Error(
      `Range ${a1} has ${count} cells which exceeds maxCells=${maxCells}. Narrow the selection or raise maxCells.`
    );
  }

  const values = [];
  const formulas = [];
  const cells = [];
  for (let r = range.r1; r <= range.r2; r += 1) {
    const rowVals = [];
    for (let c = range.c1; c <= range.c2; c += 1) {
      const cell = sheet.cells[cellKey(r, c)];
      if (!cell) {
        rowVals.push(null);
      } else {
        rowVals.push(cell.v != null ? cell.v : null);
        cells.push({
          row: r,
          col: c,
          a1: formatA1(r, c),
          value: cell.v != null ? cell.v : null,
          formula: typeof cell.f === "string" && cell.f ? cell.f : null,
          style: cloneJson(cell.style) || null,
        });
        if (cellHasFormulaEvidence(cell)) {
          formulas.push({
            row: r,
            col: c,
            formula: typeof cell.f === "string" && cell.f ? cell.f : null,
            formulaEvidence: true,
            formulaType: cell.formulaType || cell.formulaGroupType || null,
            formulaRef: cell.formulaRef || cell.formulaGroupRef || null,
            value: cell.v != null ? cell.v : null,
          });
        }
      }
    }
    values.push(rowVals);
  }

  return {
    summary: `Read ${sheet.name}!${a1} (${count} cells, ${formulas.length} formulas)`,
    workbookId,
    revision: workbook.revision,
    calculationStatus: cloneJson(workbook.calculationStatus),
    sheetId: sheet.id,
    sheetName: sheet.name,
    a1,
    rowCount: range.r2 - range.r1 + 1,
    columnCount: range.c2 - range.c1 + 1,
    values,
    formulas,
    cells,
    layout: cloneJson(sheet.layout),
  };
}

function summarizeRange(input = {}) {
  const workspacePath = requireWorkspace(input);
  const workbookId = requireWorkbookId(input);
  const workbook = loadOrGet(workspacePath, workbookId);
  const maxCells = requirePositiveSafeInteger(input.maxCells, DEFAULT_MAX_CELLS, "maxCells");
  if (maxCells > MAX_READ_RANGE_CELLS) {
    throw new Error(`[READ_CELL_LIMIT] maxCells cannot exceed ${MAX_READ_RANGE_CELLS}.`);
  }
  const { sheet, range, a1 } = resolveRange(workbook, input);
  const count = cellCount(range.r1, range.c1, range.r2, range.c2);
  if (count > maxCells) {
    throw new Error(
      `Range ${a1} has ${count} cells which exceeds maxCells=${maxCells}. Narrow the selection or raise maxCells.`
    );
  }

  let numericCount = 0;
  let emptyCount = 0;
  let formulaCount = 0;
  let textCount = 0;
  const sampleRows = [];
  const headerRow = [];

  for (let r = range.r1; r <= range.r2; r += 1) {
    const sample = [];
    for (let c = range.c1; c <= range.c2; c += 1) {
      const cell = sheet.cells[cellKey(r, c)];
      if (!cell || (cell.v == null && !cellHasFormulaEvidence(cell))) {
        emptyCount += 1;
        sample.push("");
        if (r === range.r1) headerRow.push("");
        continue;
      }
      const hasFormula = cellHasFormulaEvidence(cell);
      if (hasFormula) formulaCount += 1;
      if (typeof cell.v === "number") {
        numericCount += 1;
      } else if (cell.v != null && cell.v !== "") {
        textCount += 1;
      } else if (!hasFormula) {
        emptyCount += 1;
      }
      const display = cell.v != null
        ? cell.v
        : cell.f
          ? `=${cell.f}`
          : hasFormula
            ? "[formula result unavailable]"
            : "";
      sample.push(display);
      if (r === range.r1) headerRow.push(String(display));
    }
    if (sampleRows.length < 20) {
      sampleRows.push(sample);
    }
  }

  const headerGuess = headerRow.some((h) => h !== "" && Number.isNaN(Number(h)));
  const sampleTsv = sampleRows.map((row) => row.map((v) => String(v)).join("\t")).join("\n");

  return {
    summary: `Summary of ${sheet.name}!${a1}: numeric=${numericCount}, empty=${emptyCount}, formulas=${formulaCount}`,
    workbookId,
    revision: workbook.revision,
    calculationStatus: cloneJson(workbook.calculationStatus),
    sheetId: sheet.id,
    sheetName: sheet.name,
    a1,
    stats: {
      cellCount: count,
      numericCount,
      emptyCount,
      formulaCount,
      textCount,
      headerGuess,
    },
    sampleTsv,
    sampleRowCount: sampleRows.length,
  };
}

function buildPatchCells(sheet, input, maxCells = MAX_LOCAL_PATCH_CELLS) {
  assertSheetDimensions(Number(sheet.rows), Number(sheet.cols), `Worksheet ${sheet.name || sheet.id}`);
  const cells = [];
  if (Array.isArray(input.cells) && input.cells.length > 0) {
    if (input.cells.length > maxCells) {
      throw new Error(`[PATCH_CELL_LIMIT] Patch exceeds the maximum of ${maxCells} cells.`);
    }
    for (const item of input.cells) {
      if (!item || typeof item !== "object") continue;
      const row = Number(item.row);
      const col = Number(item.col);
      assertCellCoordinates(row, col, `Patch cell row=${item.row}, col=${item.col}`);
      const beforeCell = sheet.cells[cellKey(row, col)] || null;
      const hasMutation = Object.prototype.hasOwnProperty.call(item, "formula")
        || Object.prototype.hasOwnProperty.call(item, "value")
        || Object.prototype.hasOwnProperty.call(item, "style")
        || Object.prototype.hasOwnProperty.call(item, "styleRole");
      if (!hasMutation) {
        continue;
      }
      const after = cellFromPatch(beforeCell, item);
      cells.push({
        r: row,
        c: col,
        before: cloneCell(beforeCell),
        after: cloneCell(after),
      });
    }
    return cells;
  }

  if (Array.isArray(input.values)) {
    const { range } = (() => {
      if (input.a1) {
        return { range: clampRange(parseA1(input.a1), sheet.rows, sheet.cols) };
      }
      return { range: { r1: 0, c1: 0, r2: 0, c2: 0 } };
    })();
    for (let i = 0; i < input.values.length; i += 1) {
      const rowVals = input.values[i];
      if (!Array.isArray(rowVals)) continue;
      for (let j = 0; j < rowVals.length; j += 1) {
        if (cells.length >= maxCells) {
          throw new Error(`[PATCH_CELL_LIMIT] Patch exceeds the maximum of ${maxCells} cells.`);
        }
        const row = range.r1 + i;
        const col = range.c1 + j;
        assertCellCoordinates(row, col, `Patch matrix cell row=${row}, col=${col}`);
        const value = rowVals[j];
        const beforeCell = sheet.cells[cellKey(row, col)] || null;
        let after = null;
        if (value !== null && value !== undefined && value !== "") {
          after = typeof value === "string" && value.trim().startsWith("=")
            ? cellFromPatch(beforeCell, { formula: value })
            : cellFromPatch(beforeCell, { value });
        }
        cells.push({
          r: row,
          c: col,
          before: cloneCell(beforeCell),
          after,
        });
      }
    }
    return cells;
  }

  throw new Error("proposePatch requires cells[] or values[][]");
}

function proposePatch(input = {}) {
  const workspacePath = requireWorkspace(input);
  const workbookId = requireWorkbookId(input);
  const workbook = loadOrGet(workspacePath, workbookId);
  assertWritable(workbook, "proposePatch");
  assertExpectedRevision(workbook, input, "proposePatch");
  if (workbook.proposal) {
    throw new Error(
      `[ACTIVE_PROPOSAL_EXISTS] Proposal ${workbook.proposal.id} is still active. Accept or reject it before creating another proposal.`
    );
  }
  const sheet = resolveSheet(workbook, input.sheetId, input.a1);
  const hasCellPatch = (Array.isArray(input.cells) && input.cells.length > 0) || Array.isArray(input.values);
  const patchCells = hasCellPatch ? buildPatchCells(sheet, input, MAX_PROPOSAL_CELLS) : [];
  const rawLayout = layoutFromPatch(sheet, input.layout, patchCells);
  const layout = rawLayout && !stableEqual(rawLayout.before, rawLayout.after) ? rawLayout : null;
  if (patchCells.length === 0 && !layout) throw new Error("proposePatch produced an empty patch");

  const validation = validatePatchCells(sheet, patchCells);
  validation.layoutChanged = Boolean(layout);
  validation.layoutPartialAccept = layout
    ? "Layout is applied only when the proposal is accepted without cellRefs."
    : null;
  if (validation.errors.length > 0) {
    throw new Error(`[INVALID_PROPOSAL] ${validation.errors.join(" ")}`);
  }
  if (patchCells.length > 0 && validation.noOpCount === patchCells.length && !layout) {
    throw new Error("proposePatch produced no content changes");
  }
  const a1 = proposalRange(patchCells);
  const proposal = {
    id: newId("prop"),
    sheetId: sheet.id,
    a1,
    cells: patchCells,
    baseRevision: workbook.revision,
    intent: typeof input.intent === "string" && input.intent.trim()
      ? input.intent.trim()
      : null,
    validation,
    layout,
    createdAt: nowIso(),
  };
  workbook.proposal = proposal;
  // Do NOT mutate committed cells
  const saved = persist(workspacePath, workbook);
  const cellResult = proposalCellResult(proposal, input.resultCellLimit);
  return {
    summary: `Proposed patch ${proposal.id} on ${sheet.name}${a1 ? `!${a1}` : ""} (${patchCells.length} cells${layout ? ", layout" : ""}). Not applied until acceptProposal.`,
    proposal: proposalSummary(proposal),
    ...cellResult,
    meta: metaOf(saved),
  };
}

function getProposal(input = {}) {
  const workspacePath = requireWorkspace(input);
  const workbookId = requireWorkbookId(input);
  const workbook = loadOrGet(workspacePath, workbookId);
  if (!workbook.proposal) {
    return {
      summary: "No active proposal",
      proposal: null,
      totalCellCount: 0,
      cellDetailsTruncated: false,
    };
  }
  const sheet = getSheet(workbook, workbook.proposal.sheetId);
  const cellResult = proposalCellResult(workbook.proposal, input.resultCellLimit);
  return {
    summary: `Active proposal ${workbook.proposal.id} on ${sheet.name}${workbook.proposal.a1 ? `!${workbook.proposal.a1}` : ""}`,
    proposal: {
      ...proposalSummary(workbook.proposal),
      sheetName: sheet.name,
      ...cellResult,
    },
    totalCellCount: cellResult.totalCellCount,
    cellDetailsTruncated: cellResult.cellDetailsTruncated,
  };
}

function proposalSelection(workbook, proposal, cellRefs) {
  if (cellRefs == null) {
    const all = proposal.cells || [];
    if (all.length > MAX_ACCEPT_SELECTION_CELLS) {
      throw new Error(
        `[ACCEPT_CELL_LIMIT] Proposal contains ${all.length} cells; maximum accepted in one operation is ${MAX_ACCEPT_SELECTION_CELLS}.`
      );
    }
    return all;
  }
  if (!Array.isArray(cellRefs) || cellRefs.length === 0) {
    throw new Error("acceptProposal cellRefs must be a non-empty array when provided");
  }
  if (cellRefs.length > MAX_ACCEPT_SELECTION_CELLS) {
    throw new Error(
      `[ACCEPT_CELL_LIMIT] cellRefs contains more than ${MAX_ACCEPT_SELECTION_CELLS} entries.`
    );
  }
  const wanted = new Set();
  for (const ref of cellRefs) {
    if (typeof ref === "string") {
      const parsed = parseA1(ref);
      if (parsed.sheet) {
        const sheet = getSheet(workbook, proposal.sheetId);
        if (parsed.sheet !== proposal.sheetId && parsed.sheet.toLowerCase() !== sheet.name.toLowerCase()) {
          throw new Error(
            `acceptProposal cellRef ${ref} targets ${parsed.sheet}, but proposal ${proposal.id} targets ${sheet.name}`
          );
        }
      }
      const expandedCount = cellCount(parsed.r1, parsed.c1, parsed.r2, parsed.c2);
      if (expandedCount > MAX_ACCEPT_SELECTION_CELLS) {
        throw new Error(
          `[ACCEPT_CELL_LIMIT] ${ref} expands to ${expandedCount} cells; maximum is ${MAX_ACCEPT_SELECTION_CELLS}.`
        );
      }
      for (let r = parsed.r1; r <= parsed.r2; r += 1) {
        for (let c = parsed.c1; c <= parsed.c2; c += 1) {
          wanted.add(`${r},${c}`);
          if (wanted.size > MAX_ACCEPT_SELECTION_CELLS) {
            throw new Error(
              `[ACCEPT_CELL_LIMIT] Selected cells exceed the maximum of ${MAX_ACCEPT_SELECTION_CELLS}.`
            );
          }
        }
      }
      continue;
    }
    if (ref && typeof ref === "object") {
      const row = Number(ref.row);
      const col = Number(ref.col);
      assertCellCoordinates(row, col, `acceptProposal cellRef row=${ref.row}, col=${ref.col}`);
      wanted.add(`${row},${col}`);
      continue;
    }
    throw new Error("acceptProposal cellRefs entries must be A1 strings or {row,col}");
  }
  const selected = (proposal.cells || []).filter((cell) => wanted.has(`${cell.r},${cell.c}`));
  if (selected.length !== wanted.size) {
    const proposalKeys = new Set((proposal.cells || []).map((cell) => `${cell.r},${cell.c}`));
    const missing = [...wanted].filter((key) => !proposalKeys.has(key));
    throw new Error(`[INVALID_CELL_REFS] Cells are not in proposal ${proposal.id}: ${missing.join(", ")}`);
  }
  return selected;
}

function acceptProposal(input = {}) {
  const workspacePath = requireWorkspace(input);
  const workbookId = requireWorkbookId(input);
  const workbook = loadOrGet(workspacePath, workbookId);
  assertWritable(workbook, "acceptProposal");
  assertExpectedRevision(workbook, input, "acceptProposal");
  if (!workbook.proposal) {
    throw new Error("No active proposal to accept");
  }
  if (!input.proposalId || typeof input.proposalId !== "string") {
    throw new Error("[PROPOSAL_ID_REQUIRED] acceptProposal requires the exact reviewed proposalId.");
  }
  if (input.proposalId !== workbook.proposal.id) {
    throw new Error(
      `Proposal id mismatch: active=${workbook.proposal.id}, requested=${input.proposalId}`
    );
  }
  const proposal = workbook.proposal;
  if (proposal.baseRevision !== workbook.revision) {
    throw new Error(
      `[PROPOSAL_REVISION_CONFLICT] Proposal ${proposal.id} was created at revision ${proposal.baseRevision}, but the workbook is at revision ${workbook.revision}. Refresh the proposal before accepting it.`
    );
  }
  const sheet = getSheet(workbook, proposal.sheetId);
  const selected = proposalSelection(workbook, proposal, input.cellRefs);
  const acceptLayout = Boolean(proposal.layout && input.cellRefs == null);
  const conflicts = [];
  for (const cell of selected) {
    const current = sheet.cells[cellKey(cell.r, cell.c)] || null;
    if (!cellsEqual(current, cell.before)) {
      conflicts.push(formatA1(cell.r, cell.c));
    }
  }
  if (conflicts.length > 0) {
    throw new Error(
      `[PROPOSAL_BEFORE_CONFLICT] ${conflicts.length} cell(s) changed after the proposal was created: ${conflicts.join(", ")}. Refresh before accepting.`
    );
  }
  if (acceptLayout && !stableEqual(sheet.layout, proposal.layout.before)) {
    throw new Error(
      `[PROPOSAL_LAYOUT_CONFLICT] Sheet layout changed after proposal ${proposal.id} was created. Refresh before accepting.`
    );
  }
  assertCellMutationCapacity(workbook, selected);
  const beforeSize = { rows: sheet.rows, cols: sheet.cols };
  for (const cell of selected) {
    setSheetCell(sheet, cell.r, cell.c, cell.after);
  }
  if (acceptLayout) sheet.layout = cloneJson(proposal.layout.after);
  workbook.activeSheetId = sheet.id;
  const selectedKeys = new Set(
    selected.map((cell) => `${proposal.sheetId}:${cell.r},${cell.c}`)
  );
  const changes = [];
  if (selected.length > 0) {
    changes.push({
      kind: "cells",
      sheetId: sheet.id,
      beforeSize,
      afterSize: { rows: sheet.rows, cols: sheet.cols },
      cells: cloneJson(selected),
    });
  }
  if (acceptLayout) {
    changes.push({ kind: "layout", sheetId: sheet.id, ...cloneJson(proposal.layout) });
  }
  const hasStyleChanges = cellChangesStyle(selected);
  const operation = recordOperation(workbook, {
    type: "accept-proposal",
    actor: input.actor || "user",
    intent: proposal.intent || input.intent || null,
    summary: `Accepted ${selected.length} cell(s)${acceptLayout ? " and layout" : ""} from proposal ${proposal.id}`,
    sheetId: sheet.id,
    a1: proposalRange(selected),
    cellCount: selected.length,
    roundTripSafe: !hasStyleChanges && !acceptLayout,
    contentChanged: cellChangesContent(selected),
    structureChanged: false,
    fidelityWarning: hasStyleChanges && acceptLayout
      ? "New or changed cell styles and worksheet layout cannot be added to an imported Excel package by the source-preserving patcher. Save As with fidelity-loss acknowledgement to rebuild a styled .xlsx copy."
      : hasStyleChanges
        ? "New or changed cell styles cannot be added to an imported Excel package by the source-preserving patcher. Save As with fidelity-loss acknowledgement to rebuild a styled .xlsx copy."
      : acceptLayout
        ? "New or changed worksheet layout cannot be patched into an imported Excel package losslessly. Save As with fidelity-loss acknowledgement to rebuild an .xlsx copy."
        : null,
    change: changes.length === 1 ? changes[0] : { kind: "compound", changes },
  });
  rebaseProposal(workbook, selectedKeys, acceptLayout);
  const saved = persist(workspacePath, workbook);
  return {
    summary: `Accepted proposal ${proposal.id} on ${sheet.name}${proposalRange(selected) ? `!${proposalRange(selected)}` : ""} (${selected.length} cells${acceptLayout ? ", layout" : ""})`,
    applied: {
      proposalId: proposal.id,
      operationId: operation.id,
      sheetId: sheet.id,
      sheetName: sheet.name,
      a1: proposalRange(selected),
      cellCount: selected.length,
      layoutApplied: acceptLayout,
      revision: saved.revision,
    },
    remainingProposal: proposalSummary(saved.proposal),
    meta: metaOf(saved),
  };
}

function rejectProposal(input = {}) {
  const workspacePath = requireWorkspace(input);
  const workbookId = requireWorkbookId(input);
  const workbook = loadOrGet(workspacePath, workbookId);
  assertExpectedRevision(workbook, input, "rejectProposal");
  if (!workbook.proposal) {
    return {
      summary: "No active proposal to reject",
      proposal: null,
      meta: metaOf(workbook),
    };
  }
  if (!input.proposalId || typeof input.proposalId !== "string") {
    throw new Error("[PROPOSAL_ID_REQUIRED] rejectProposal requires the exact reviewed proposalId.");
  }
  if (input.proposalId !== workbook.proposal.id) {
    throw new Error(
      `Proposal id mismatch: active=${workbook.proposal.id}, requested=${input.proposalId}`
    );
  }
  const rejectedId = workbook.proposal.id;
  const a1 = workbook.proposal.a1;
  workbook.proposal = null;
  const saved = persist(workspacePath, workbook);
  return {
    summary: `Rejected proposal ${rejectedId} (${a1})`,
    rejectedProposalId: rejectedId,
    meta: metaOf(saved),
  };
}

function applyLocalEdit(input = {}) {
  const workspacePath = requireWorkspace(input);
  const workbookId = requireWorkbookId(input);
  const workbook = loadOrGet(workspacePath, workbookId);
  assertWritable(workbook, "applyLocalEdit");
  assertExpectedRevision(workbook, input, "applyLocalEdit");
  const sheet = getSheet(workbook, input.sheetId || workbook.activeSheetId);
  const row = Number(input.row);
  const col = Number(input.col);
  assertCellCoordinates(row, col, "Local edit cell");
  const beforeSize = { rows: sheet.rows, cols: sheet.cols };
  const before = cloneCell(sheet.cells[cellKey(row, col)] || null);
  const previewAfter = cellFromPatch(before, input);
  const validation = validatePatchCells(sheet, [{ r: row, c: col, before, after: previewAfter }]);
  if (validation.errors.length > 0) {
    throw new Error(`[INVALID_LOCAL_EDIT] ${validation.errors.join(" ")}`);
  }
  assertCellMutationCapacity(workbook, [{
    before,
    after: previewAfter,
  }]);
  const after = setCell(sheet, row, col, {
    value: input.value,
    formula: input.formula,
    style: input.style,
    styleRole: input.styleRole,
  });
  workbook.focus = {
    sheetId: sheet.id,
    a1: formatA1(row, col),
    kind: "cell",
  };
  let operation = null;
  if (!cellsEqual(before, after)) {
    operation = recordOperation(workbook, {
      type: "local-edit",
      actor: input.actor || "user",
      intent: input.intent || null,
      summary: `Edited ${sheet.name}!${formatA1(row, col)}`,
      sheetId: sheet.id,
      a1: formatA1(row, col),
      cellCount: 1,
      roundTripSafe: !cellChangesStyle([{ before, after }]),
      contentChanged: !cellsContentEqual(before, after),
      structureChanged: false,
      fidelityWarning: "New or changed cell styles cannot be patched into an imported Excel package losslessly. Save As with fidelity-loss acknowledgement to rebuild a styled .xlsx copy.",
      change: {
        kind: "cells",
        sheetId: sheet.id,
        beforeSize,
        afterSize: { rows: sheet.rows, cols: sheet.cols },
        cells: [{ r: row, c: col, before, after: cloneCell(after) }],
      },
    });
  }
  rebaseProposal(workbook, new Set([`${sheet.id}:${row},${col}`]));
  const saved = persist(workspacePath, workbook);
  return {
    summary: `Local edit at ${sheet.name}!${formatA1(row, col)}`,
    edit: {
      sheetId: sheet.id,
      sheetName: sheet.name,
      row,
      col,
      a1: formatA1(row, col),
      before: cellDisplay(before),
      after: cellDisplay(after),
      operationId: operation ? operation.id : null,
    },
    validation,
    meta: metaOf(saved),
  };
}

function applyLocalPatch(input = {}) {
  const workspacePath = requireWorkspace(input);
  const workbookId = requireWorkbookId(input);
  const workbook = loadOrGet(workspacePath, workbookId);
  assertWritable(workbook, "applyLocalPatch");
  assertExpectedRevision(workbook, input, "applyLocalPatch");
  const sheet = resolveSheet(workbook, input.sheetId, input.a1);
  const patchCells = buildPatchCells(sheet, input, MAX_LOCAL_PATCH_CELLS);
  const validation = validatePatchCells(sheet, patchCells);
  if (validation.errors.length > 0) {
    throw new Error(`[INVALID_LOCAL_PATCH] ${validation.errors.join(" ")}`);
  }
  const changed = patchCells.filter((cell) => !cellsEqual(cell.before, cell.after));
  if (changed.length === 0) {
    return {
      summary: "Local patch made no content changes",
      applied: { sheetId: sheet.id, sheetName: sheet.name, a1: null, cellCount: 0 },
      meta: metaOf(workbook),
    };
  }
  assertCellMutationCapacity(workbook, changed);
  const beforeSize = { rows: sheet.rows, cols: sheet.cols };
  for (const cell of changed) {
    setSheetCell(sheet, cell.r, cell.c, cell.after);
  }
  const a1 = proposalRange(changed);
  workbook.activeSheetId = sheet.id;
  workbook.focus = {
    sheetId: sheet.id,
    a1,
    kind: changed.length === 1 ? "cell" : "range",
  };
  const operation = recordOperation(workbook, {
    type: "local-patch",
    actor: input.actor || "user",
    intent: input.intent || "Paste cells",
    summary: `Applied local patch to ${sheet.name}!${a1}`,
    sheetId: sheet.id,
    a1,
    cellCount: changed.length,
    roundTripSafe: !cellChangesStyle(changed),
    contentChanged: cellChangesContent(changed),
    structureChanged: false,
    fidelityWarning: "New or changed cell styles cannot be patched into an imported Excel package losslessly. Save As with fidelity-loss acknowledgement to rebuild a styled .xlsx copy.",
    change: {
      kind: "cells",
      sheetId: sheet.id,
      beforeSize,
      afterSize: { rows: sheet.rows, cols: sheet.cols },
      cells: cloneJson(changed),
    },
  });
  rebaseProposal(
    workbook,
    new Set(changed.map((cell) => `${sheet.id}:${cell.r},${cell.c}`))
  );
  const saved = persist(workspacePath, workbook);
  return {
    summary: `Applied ${changed.length} local cell edit(s) to ${sheet.name}!${a1}`,
    applied: {
      operationId: operation.id,
      sheetId: sheet.id,
      sheetName: sheet.name,
      a1,
      cellCount: changed.length,
      revision: saved.revision,
    },
    validation,
    meta: metaOf(saved),
  };
}

function applyLayout(input = {}) {
  const workspacePath = requireWorkspace(input);
  const workbookId = requireWorkbookId(input);
  const workbook = loadOrGet(workspacePath, workbookId);
  assertWritable(workbook, "applyLayout");
  assertExpectedRevision(workbook, input, "applyLayout");
  const sheet = getSheet(workbook, input.sheetId || workbook.activeSheetId);
  const change = layoutFromPatch(sheet, input.layout);
  if (!change || stableEqual(change.before, change.after)) {
    return { summary: "Layout already matches", layout: cloneJson(sheet.layout), meta: metaOf(workbook) };
  }
  sheet.layout = cloneJson(change.after);
  const operation = recordOperation(workbook, {
    type: "apply-layout",
    actor: input.actor || "user",
    intent: input.intent || null,
    summary: `Updated layout on ${sheet.name}`,
    sheetId: sheet.id,
    cellCount: 0,
    roundTripSafe: false,
    contentChanged: false,
    structureChanged: false,
    fidelityWarning: "New or changed worksheet layout cannot be patched into an imported Excel package losslessly. Save As with fidelity-loss acknowledgement to rebuild an .xlsx copy.",
    change: { kind: "layout", sheetId: sheet.id, ...cloneJson(change) },
  });
  rebaseProposal(workbook);
  const saved = persist(workspacePath, workbook);
  return {
    summary: `Updated layout on ${sheet.name}`,
    operationId: operation.id,
    sheetId: sheet.id,
    layout: cloneJson(sheet.layout),
    meta: metaOf(saved),
  };
}

function clearRange(input = {}) {
  const workspacePath = requireWorkspace(input);
  const workbookId = requireWorkbookId(input);
  const workbook = loadOrGet(workspacePath, workbookId);
  assertWritable(workbook, "clearRange");
  assertExpectedRevision(workbook, input, "clearRange");
  if (!input.a1) {
    throw new Error("a1 is required for clearRange");
  }
  const { sheet, range, a1 } = resolveRange(workbook, input);
  let cleared = 0;
  const changes = [];
  const beforeSize = { rows: sheet.rows, cols: sheet.cols };
  for (let r = range.r1; r <= range.r2; r += 1) {
    for (let c = range.c1; c <= range.c2; c += 1) {
      const key = cellKey(r, c);
      if (sheet.cells[key]) {
        changes.push({ r, c, before: cloneCell(sheet.cells[key]), after: null });
        delete sheet.cells[key];
        cleared += 1;
      }
    }
  }
  let operation = null;
  if (changes.length > 0) {
    operation = recordOperation(workbook, {
      type: "clear-range",
      actor: input.actor || "user",
      intent: input.intent || null,
      summary: `Cleared ${sheet.name}!${a1}`,
      sheetId: sheet.id,
      a1,
      cellCount: changes.length,
      change: {
        kind: "cells",
        sheetId: sheet.id,
        beforeSize,
        afterSize: { rows: sheet.rows, cols: sheet.cols },
        cells: changes,
      },
    });
  }
  const excluded = new Set();
  if (workbook.proposal && workbook.proposal.sheetId === sheet.id) {
    for (const cell of workbook.proposal.cells || []) {
      if (cell.r >= range.r1 && cell.r <= range.r2 && cell.c >= range.c1 && cell.c <= range.c2) {
        excluded.add(`${sheet.id}:${cell.r},${cell.c}`);
      }
    }
  }
  rebaseProposal(workbook, excluded);
  const saved = persist(workspacePath, workbook);
  return {
    summary: `Cleared ${cleared} cell(s) in ${sheet.name}!${a1}`,
    sheetId: sheet.id,
    a1,
    clearedCount: cleared,
    operationId: operation ? operation.id : null,
    meta: metaOf(saved),
  };
}

function listWorkbooks(input = {}) {
  const workspacePath = requireWorkspace(input);
  const workbooks = listWorkbookMetas(workspacePath);
  return {
    summary: `${workbooks.length} workbook store(s) in workspace`,
    workbooks,
  };
}

function saveWorkbook(input = {}) {
  const workspacePath = requireWorkspace(input);
  const workbookId = requireWorkbookId(input);
  const workbook = loadOrGet(workspacePath, workbookId);
  assertExpectedRevision(workbook, input, "saveWorkbook");
  const targetPath = input.path
    ? resolveConsumerPath(input, workspacePath, input.path, "saveWorkbook")
    : workbook.path
      ? assertConsumerPathAllowed(
          input,
          workspacePath,
          path.resolve(workbook.path),
          "saveWorkbook"
        )
      : null;

  if (targetPath && path.extname(targetPath).toLowerCase() === ".csv") {
    throw new Error(
      "[CSV_EXPORT_ACTION_REQUIRED] saveWorkbook cannot export CSV. Use exportCsv so formula freshness checks and formula-injection sanitization are enforced."
    );
  }

  const sourcePath = workbook.sourcePath || null;
  const exportCopy = input.exportCopy === true;
  const excelSource = ["xlsx", "xlsm"].includes(
    String(workbook.sourceFormat || "").toLowerCase()
  );
  const overwritesSource = Boolean(
    targetPath &&
      sourcePath &&
      pathsReferToSameFile(targetPath, sourcePath)
  );
  if (overwritesSource && input.allowSourceOverwrite !== true) {
    throw new Error(
      `[SOURCE_OVERWRITE_BLOCKED] ${sourcePath} is the imported source. Use Save As with a different path, or explicitly set allowSourceOverwrite=true after reviewing fidelity.`
    );
  }
  if (overwritesSource && workbook.fidelity?.canRoundTrip === false) {
    throw new Error(
      "[LOSSY_SOURCE_OVERWRITE_BLOCKED] The imported source can never be overwritten with a lossy rebuild. Choose a new .xlsx path and acknowledge fidelity loss there."
    );
  }
  if (
    targetPath &&
    excelSource &&
    workbook.fidelity &&
    workbook.fidelity.canRoundTrip === false &&
    input.acknowledgeFidelityLoss !== true
  ) {
    throw new Error(
      `[FIDELITY_ACK_REQUIRED] This workbook cannot be exported losslessly: ${workbook.fidelity.warning || "unsupported workbook features may be lost"} Set acknowledgeFidelityLoss=true only after choosing an appropriate Save As target.`
    );
  }

  const savedStore = persist(workspacePath, workbook);
  let exportResult = null;
  if (targetPath) {
    const atomicWriteOptions = prepareAtomicTargetWrite(input, targetPath, sourcePath);
    exportResult = writeWorkbookFile(savedStore, targetPath, {
      allowLossyRebuild:
        input.acknowledgeFidelityLoss === true && !overwritesSource,
      atomicWriteOptions,
    });
    if (overwritesSource && exportResult.outputFingerprint) {
      savedStore.sourceFingerprint = cloneJson(exportResult.outputFingerprint);
    }
    if (!exportCopy) savedStore.path = targetPath;
    savedStore.lastExportPath = targetPath;
    savedStore.lastExportedRevision = savedStore.revision;
    savedStore.lastExportFingerprint = readStableFile(targetPath).fingerprint;
    savedStore.dirty = false;
    persist(workspacePath, savedStore);
  } else {
    savedStore.dirty = false;
    persist(workspacePath, savedStore);
  }

  return {
    summary: targetPath
      ? exportCopy
        ? `Exported workbook copy to ${targetPath}; source association remains ${sourcePath || "internal store"}`
        : `Saved workbook store and exported to ${targetPath}`
      : `Saved workbook store for ${workbookId} (no external path)`,
    meta: metaOf(sessions.get(workbookId).workbook),
    storePath: path.join(workspacePath, ".sparo_os", "excel-live", workbookId, "workbook.json"),
    export: exportResult,
    exportCopy,
    workingPath: sessions.get(workbookId).workbook.path || null,
    sourceProtected: Boolean(sourcePath),
  };
}

function exportCsv(input = {}) {
  const workspacePath = requireWorkspace(input);
  const workbookId = requireWorkbookId(input);
  const workbook = loadOrGet(workspacePath, workbookId);
  assertExpectedRevision(workbook, input, "exportCsv");
  const sheet = getSheet(workbook, input.sheetId || workbook.activeSheetId);
  const matrix = sheetToMatrix(sheet);
  let exportedFormulaCount = 0;
  let sanitizedCellCount = 0;
  const uncachedFormulaRefs = [];
  for (let r = 0; r < matrix.length; r += 1) {
    for (let c = 0; c < (matrix[r] || []).length; c += 1) {
      const cell = sheet.cells[cellKey(r, c)];
      if (!cell) continue;
      if (cellHasFormulaEvidence(cell)) {
        exportedFormulaCount += 1;
        if (!Object.prototype.hasOwnProperty.call(cell, "v") || cell.v == null) {
          uncachedFormulaRefs.push(formatA1(r, c));
          continue;
        }
        const cachedValue = matrix[r][c];
        if (typeof cachedValue === "string" && /^[=+\-@\t\r\n]/.test(cachedValue)) {
          matrix[r][c] = `'${cachedValue}`;
          sanitizedCellCount += 1;
        }
        continue;
      }
      const isText = cell.t === "s" || cell.t === "str" || typeof cell.v === "string";
      const value = matrix[r][c];
      if (isText && typeof value === "string" && /^[=+\-@\t\r\n]/.test(value)) {
        matrix[r][c] = `'${value}`;
        sanitizedCellCount += 1;
      }
    }
  }
  if (uncachedFormulaRefs.length > 0) {
    const sample = uncachedFormulaRefs.slice(0, 20).join(", ");
    throw new Error(
      `[UNCACHED_FORMULA_CSV_BLOCKED] Sheet ${sheet.name} has ${uncachedFormulaRefs.length} formula cell(s) without cached results (${sample}). CSV export will not emit executable formula text as if it were a calculated value. Recalculate in Excel first.`
    );
  }
  if (exportedFormulaCount > 0 && input.acknowledgeStaleFormulaValues !== true) {
    throw new Error(
      `[STALE_FORMULA_VALUES_ACK_REQUIRED] Sheet ${sheet.name} contains ${exportedFormulaCount} formula cell(s). The live engine does not recalculate formulas, so cached CSV values may be stale. Review calculationStatus=${workbook.calculationStatus?.status || "unknown"} and set acknowledgeStaleFormulaValues=true to export intentionally.`
    );
  }
  const csv = serializeCsv(matrix);
  let outPath = input.path || null;
  if (outPath) {
    outPath = resolveConsumerPath(input, workspacePath, outPath, "exportCsv");
    const actualOutPath = path.extname(outPath).toLowerCase() === ".csv"
      ? outPath
      : `${outPath}.csv`;
    if (
      workbook.sourcePath &&
      pathsReferToSameFile(actualOutPath, workbook.sourcePath)
    ) {
      throw new Error(
        "[SOURCE_OVERWRITE_BLOCKED] exportCsv cannot replace the imported source. Choose a new path."
      );
    }
    const atomicWriteOptions = prepareAtomicTargetWrite(input, actualOutPath, workbook.sourcePath);
    writeFileAtomic(actualOutPath, csv, "utf8", atomicWriteOptions);
    outPath = actualOutPath;
  }
  const warnings = [];
  if (exportedFormulaCount > 0) {
    warnings.push(
      `${exportedFormulaCount} formula cell(s) were exported using cached values that may be stale.`
    );
  }
  if (sanitizedCellCount > 0) {
    warnings.push(
      `${sanitizedCellCount} text cell(s) with formula-injection prefixes were escaped with a leading apostrophe.`
    );
  }
  return {
    summary: outPath
      ? `Exported sheet "${sheet.name}" to ${outPath}`
      : `Serialized sheet "${sheet.name}" to CSV (${matrix.length} rows)`,
    sheetId: sheet.id,
    sheetName: sheet.name,
    path: outPath,
    csv: outPath ? undefined : csv,
    rowCount: matrix.length,
    columnCount: matrix[0] ? matrix[0].length : 0,
    formulaCount: exportedFormulaCount,
    sanitizedCellCount,
    calculationStatus: cloneJson(workbook.calculationStatus),
    warning: warnings.length > 0 ? warnings.join(" ") : null,
  };
}

function shiftCells(sheet, predicate, mapper) {
  const next = {};
  for (const [key, cell] of Object.entries(sheet.cells || {})) {
    const [rs, cs] = key.split(",");
    const r = Number(rs);
    const c = Number(cs);
    if (!predicate(r, c)) {
      next[key] = cell;
      continue;
    }
    const mapped = mapper(r, c, cell);
    if (!mapped) continue;
    assertCellCoordinates(mapped.r, mapped.c, "Shifted worksheet cell");
    next[cellKey(mapped.r, mapped.c)] = mapped.cell;
  }
  sheet.cells = next;
}

function assertStructureEditSafe(workbook, action) {
  const count = formulaCount(workbook);
  if (count > 0) {
    throw new Error(
      `[FORMULA_REFERENCE_RISK] ${action} is blocked because the workbook contains ${count} formula cell(s), and this engine cannot safely rewrite formula references.`
    );
  }
}

function assertLayoutStructureEditSafe(sheet, axis, action) {
  const layout = normalizeSheetLayout(sheet.layout);
  const hasAxisBands = axis === "rows" ? layout.rows.length > 0 : layout.columns.length > 0;
  const hasAxisFreeze = axis === "rows"
    ? layout.freezePanes.rows > 0
    : layout.freezePanes.columns > 0;
  if (hasAxisBands || hasAxisFreeze || layout.autoFilter) {
    throw new Error(
      `[LAYOUT_REFERENCE_RISK] ${action} is blocked because ${sheet.name} has ${axis} layout, freeze panes, or an auto filter that this engine cannot safely rewrite. Apply structural edits before layout, or clear the affected layout first.`
    );
  }
}

function insertRows(input = {}) {
  const workspacePath = requireWorkspace(input);
  const workbookId = requireWorkbookId(input);
  const workbook = loadOrGet(workspacePath, workbookId);
  assertWritable(workbook, "insertRows");
  assertExpectedRevision(workbook, input, "insertRows");
  assertStructureEditSafe(workbook, "insertRows");
  const sheet = getSheet(workbook, input.sheetId || workbook.activeSheetId);
  assertLayoutStructureEditSafe(sheet, "rows", "insertRows");
  const at = Number(input.at == null ? input.row : input.at);
  const count = requirePositiveSafeInteger(input.count, 1, "count");
  if (!Number.isSafeInteger(at) || at < 0 || at > sheet.rows) {
    throw new Error("at/row must be a safe integer within the worksheet row boundary");
  }
  if (sheet.rows + count > EXCEL_MAX_ROWS) {
    throw new Error(`[EXCEL_ROW_LIMIT] Inserting ${count} row(s) would exceed ${EXCEL_MAX_ROWS}.`);
  }
  const before = cloneJson(sheet);
  shiftCells(
    sheet,
    (r) => r >= at,
    (r, c, cell) => ({ r: r + count, c, cell })
  );
  sheet.rows += count;
  workbook.proposal = null;
  const operation = recordOperation(workbook, {
    type: "insert-rows",
    actor: input.actor || "user",
    intent: input.intent || null,
    summary: `Inserted ${count} row(s) at ${at} on ${sheet.name}`,
    sheetId: sheet.id,
    cellCount: 0,
    roundTripSafe: false,
    change: { kind: "sheet", sheetId: sheet.id, before, after: cloneJson(sheet) },
  });
  const saved = persist(workspacePath, workbook);
  return {
    summary: `Inserted ${count} row(s) at ${at} on "${sheet.name}"`,
    sheetId: sheet.id,
    at,
    count,
    operationId: operation.id,
    meta: metaOf(saved),
  };
}

function insertColumns(input = {}) {
  const workspacePath = requireWorkspace(input);
  const workbookId = requireWorkbookId(input);
  const workbook = loadOrGet(workspacePath, workbookId);
  assertWritable(workbook, "insertColumns");
  assertExpectedRevision(workbook, input, "insertColumns");
  assertStructureEditSafe(workbook, "insertColumns");
  const sheet = getSheet(workbook, input.sheetId || workbook.activeSheetId);
  assertLayoutStructureEditSafe(sheet, "columns", "insertColumns");
  const at = Number(input.at == null ? input.col : input.at);
  const count = requirePositiveSafeInteger(input.count, 1, "count");
  if (!Number.isSafeInteger(at) || at < 0 || at > sheet.cols) {
    throw new Error("at/col must be a safe integer within the worksheet column boundary");
  }
  if (sheet.cols + count > EXCEL_MAX_COLUMNS) {
    throw new Error(`[EXCEL_COLUMN_LIMIT] Inserting ${count} column(s) would exceed ${EXCEL_MAX_COLUMNS}.`);
  }
  const before = cloneJson(sheet);
  shiftCells(
    sheet,
    (_r, c) => c >= at,
    (r, c, cell) => ({ r, c: c + count, cell })
  );
  sheet.cols += count;
  workbook.proposal = null;
  const operation = recordOperation(workbook, {
    type: "insert-columns",
    actor: input.actor || "user",
    intent: input.intent || null,
    summary: `Inserted ${count} column(s) at ${at} on ${sheet.name}`,
    sheetId: sheet.id,
    cellCount: 0,
    roundTripSafe: false,
    change: { kind: "sheet", sheetId: sheet.id, before, after: cloneJson(sheet) },
  });
  const saved = persist(workspacePath, workbook);
  return {
    summary: `Inserted ${count} column(s) at ${at} on "${sheet.name}"`,
    sheetId: sheet.id,
    at,
    count,
    operationId: operation.id,
    meta: metaOf(saved),
  };
}

function deleteRows(input = {}) {
  const workspacePath = requireWorkspace(input);
  const workbookId = requireWorkbookId(input);
  const workbook = loadOrGet(workspacePath, workbookId);
  assertWritable(workbook, "deleteRows");
  assertExpectedRevision(workbook, input, "deleteRows");
  assertStructureEditSafe(workbook, "deleteRows");
  const sheet = getSheet(workbook, input.sheetId || workbook.activeSheetId);
  assertLayoutStructureEditSafe(sheet, "rows", "deleteRows");
  const at = Number(input.at == null ? input.row : input.at);
  const count = requirePositiveSafeInteger(input.count, 1, "count");
  if (!Number.isSafeInteger(at) || at < 0 || at >= sheet.rows) {
    throw new Error("at/row must be a safe integer within the worksheet row boundary");
  }
  if (count > sheet.rows - at) {
    throw new Error("deleteRows count exceeds the remaining worksheet rows");
  }
  const before = cloneJson(sheet);
  shiftCells(
    sheet,
    (r) => r >= at,
    (r, c, cell) => {
      if (r < at + count) return null;
      return { r: r - count, c, cell };
    }
  );
  sheet.rows = Math.max(1, sheet.rows - count);
  workbook.proposal = null;
  const operation = recordOperation(workbook, {
    type: "delete-rows",
    actor: input.actor || "user",
    intent: input.intent || null,
    summary: `Deleted ${count} row(s) at ${at} on ${sheet.name}`,
    sheetId: sheet.id,
    cellCount: 0,
    roundTripSafe: false,
    change: { kind: "sheet", sheetId: sheet.id, before, after: cloneJson(sheet) },
  });
  const saved = persist(workspacePath, workbook);
  return {
    summary: `Deleted ${count} row(s) at ${at} on "${sheet.name}"`,
    sheetId: sheet.id,
    at,
    count,
    operationId: operation.id,
    meta: metaOf(saved),
  };
}

function deleteColumns(input = {}) {
  const workspacePath = requireWorkspace(input);
  const workbookId = requireWorkbookId(input);
  const workbook = loadOrGet(workspacePath, workbookId);
  assertWritable(workbook, "deleteColumns");
  assertExpectedRevision(workbook, input, "deleteColumns");
  assertStructureEditSafe(workbook, "deleteColumns");
  const sheet = getSheet(workbook, input.sheetId || workbook.activeSheetId);
  assertLayoutStructureEditSafe(sheet, "columns", "deleteColumns");
  const at = Number(input.at == null ? input.col : input.at);
  const count = requirePositiveSafeInteger(input.count, 1, "count");
  if (!Number.isSafeInteger(at) || at < 0 || at >= sheet.cols) {
    throw new Error("at/col must be a safe integer within the worksheet column boundary");
  }
  if (count > sheet.cols - at) {
    throw new Error("deleteColumns count exceeds the remaining worksheet columns");
  }
  const before = cloneJson(sheet);
  shiftCells(
    sheet,
    (_r, c) => c >= at,
    (r, c, cell) => {
      if (c < at + count) return null;
      return { r, c: c - count, cell };
    }
  );
  sheet.cols = Math.max(1, sheet.cols - count);
  workbook.proposal = null;
  const operation = recordOperation(workbook, {
    type: "delete-columns",
    actor: input.actor || "user",
    intent: input.intent || null,
    summary: `Deleted ${count} column(s) at ${at} on ${sheet.name}`,
    sheetId: sheet.id,
    cellCount: 0,
    roundTripSafe: false,
    change: { kind: "sheet", sheetId: sheet.id, before, after: cloneJson(sheet) },
  });
  const saved = persist(workspacePath, workbook);
  return {
    summary: `Deleted ${count} column(s) at ${at} on "${sheet.name}"`,
    sheetId: sheet.id,
    at,
    count,
    operationId: operation.id,
    meta: metaOf(saved),
  };
}

function renameSheet(input = {}) {
  const workspacePath = requireWorkspace(input);
  const workbookId = requireWorkbookId(input);
  const workbook = loadOrGet(workspacePath, workbookId);
  assertWritable(workbook, "renameSheet");
  assertExpectedRevision(workbook, input, "renameSheet");
  assertStructureEditSafe(workbook, "renameSheet");
  const sheet = getSheet(workbook, input.sheetId || workbook.activeSheetId);
  const name = input.name || input.sheetName;
  if (!name || typeof name !== "string" || !name.trim()) {
    throw new Error("name is required");
  }
  const trimmed = validateExcelSheetName(name);
  const clash = workbook.sheets.find(
    (s) => s.id !== sheet.id && s.name.toLowerCase() === trimmed.toLowerCase()
  );
  if (clash) {
    throw new Error(`Sheet name already exists: ${trimmed}`);
  }
  const previous = sheet.name;
  sheet.name = trimmed;
  const operation = recordOperation(workbook, {
    type: "rename-sheet",
    actor: input.actor || "user",
    intent: input.intent || null,
    summary: `Renamed sheet ${previous} to ${trimmed}`,
    sheetId: sheet.id,
    roundTripSafe: false,
    change: { kind: "sheet-name", sheetId: sheet.id, before: previous, after: trimmed },
  });
  const saved = persist(workspacePath, workbook);
  return {
    summary: `Renamed sheet "${previous}" to "${trimmed}"`,
    sheetId: sheet.id,
    previousName: previous,
    name: trimmed,
    operationId: operation.id,
    meta: metaOf(saved),
  };
}

function addSheet(input = {}) {
  const workspacePath = requireWorkspace(input);
  const workbookId = requireWorkbookId(input);
  const workbook = loadOrGet(workspacePath, workbookId);
  assertWritable(workbook, "addSheet");
  assertExpectedRevision(workbook, input, "addSheet");
  const before = captureWorkbookContent(workbook);
  const requestedName = input.name ?? input.sheetName ?? "";
  if (typeof requestedName !== "string") throw new Error("[INVALID_SHEET_NAME] Worksheet name must be a string.");
  let name = requestedName.trim();
  if (!name) {
    let i = workbook.sheets.length + 1;
    name = `Sheet${i}`;
    while (findSheetByName(workbook, name)) {
      i += 1;
      name = `Sheet${i}`;
    }
  } else if (findSheetByName(workbook, name)) {
    throw new Error(`Sheet name already exists: ${name}`);
  }
  const rows = requirePositiveSafeInteger(input.rows, 50, "rows");
  const cols = requirePositiveSafeInteger(input.cols, 26, "cols");
  assertSheetDimensions(rows, cols, "New worksheet");
  const sheet = createEmptySheet(name, rows, cols);
  workbook.sheets.push(sheet);
  if (input.activate !== false) {
    workbook.activeSheetId = sheet.id;
    workbook.focus = { sheetId: sheet.id, a1: "A1", kind: "cell" };
  }
  const operation = recordOperation(workbook, {
    type: "add-sheet",
    actor: input.actor || "user",
    intent: input.intent || null,
    summary: `Added sheet ${sheet.name}`,
    sheetId: sheet.id,
    roundTripSafe: false,
    change: { kind: "workbook", before, after: captureWorkbookContent(workbook) },
  });
  const saved = persist(workspacePath, workbook);
  return {
    summary: `Added sheet "${sheet.name}"`,
    sheet: { id: sheet.id, name: sheet.name, rows: sheet.rows, cols: sheet.cols },
    operationId: operation.id,
    meta: metaOf(saved),
  };
}

function reloadWorkbook(input = {}) {
  const workspacePath = requireWorkspace(input);
  const workbookId = requireWorkbookId(input);
  const existing = loadOrGet(workspacePath, workbookId);

  if (existing.path) {
    assertWritable(existing, "reloadWorkbook");
    assertExpectedRevision(existing, input, "reloadWorkbook");
    const before = captureWorkbookContent(existing);
    const reloaded = readWorkbookFile(existing.path, {
      workbookId: existing.workbookId,
      title: existing.title,
    });
    existing.title = reloaded.title;
    existing.sheets = cloneJson(reloaded.sheets);
    existing.activeSheetId = reloaded.activeSheetId;
    existing.focus = cloneJson(reloaded.focus);
    existing.path = reloaded.path;
    existing.sourcePath = reloaded.sourcePath;
    existing.sourceFormat = reloaded.sourceFormat;
    existing.sourceFingerprint = cloneJson(reloaded.sourceFingerprint);
    existing.fidelity = cloneJson(reloaded.fidelity);
    existing.proposal = null;
    const operation = recordOperation(existing, {
      type: "reload-workbook",
      actor: input.actor || "user",
      intent: input.intent || "Reload external workbook",
      summary: `Reloaded workbook from ${existing.path}`,
      roundTripSafe: true,
      change: { kind: "workbook", before, after: captureWorkbookContent(existing) },
    });
    existing.dirty = false;
    refreshCalculationStatus(existing, false);
    const saved = persist(workspacePath, normalizeWorkbook(existing));
    const sheet = getSheet(saved, saved.activeSheetId);
    return {
      summary: `Reloaded workbook from ${existing.path}`,
      operationId: operation.id,
      meta: metaOf(saved),
      viewport: viewportSummary(saved, sheet),
    };
  }

  const fromStore = loadJson(workspacePath, workbookId);
  sessions.set(workbookId, { workspacePath, workbook: fromStore });
  const sheet = getSheet(fromStore, fromStore.activeSheetId);
  return {
    summary: `Reloaded workbook store for ${workbookId}`,
    meta: metaOf(fromStore),
    viewport: viewportSummary(fromStore, sheet),
  };
}

const actions = {
  openWorkbook,
  createWorkbook,
  getMeta,
  getFocus,
  setFocus,
  setMode,
  readRange,
  summarizeRange,
  proposePatch,
  getProposal,
  acceptProposal,
  rejectProposal,
  applyLocalEdit,
  applyLocalPatch,
  applyLayout,
  clearRange,
  undo,
  redo,
  getHistory,
  saveWorkbook,
  exportCsv,
  listSheets,
  listWorkbooks,
  switchSheet,
  insertRows,
  insertColumns,
  deleteRows,
  deleteColumns,
  renameSheet,
  addSheet,
  reloadWorkbook,
};

function dispatch(action, input) {
  const fn = actions[action];
  if (!fn) {
    throw new Error(`Unsupported Sparo Excel Engine action: ${action}`);
  }
  return fn(input || {});
}

module.exports = {
  dispatch,
  actions,
  sessions,
  DEFAULT_MAX_CELLS,
  limits: Object.freeze({
    maxReadRangeCells: MAX_READ_RANGE_CELLS,
    maxProposalCells: MAX_PROPOSAL_CELLS,
    maxLocalPatchCells: MAX_LOCAL_PATCH_CELLS,
    maxAcceptSelectionCells: MAX_ACCEPT_SELECTION_CELLS,
  }),
};
