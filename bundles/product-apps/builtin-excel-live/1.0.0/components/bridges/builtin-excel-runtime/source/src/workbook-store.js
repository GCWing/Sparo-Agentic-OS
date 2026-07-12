const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const STORE_ROOT_SEGMENTS = [".sparo_os", "excel-live"];
const WORKBOOK_SCHEMA_VERSION = 2;
const SUPPORTED_MODES = new Set(["inspect", "edit", "author"]);
const WORKBOOK_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const WINDOWS_RESERVED_NAMES = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i;

function validateExcelSheetName(value) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("[INVALID_SHEET_NAME] Worksheet name must be a non-empty string.");
  }
  const name = value.trim();
  if (Array.from(name).length > 31) {
    throw new Error("[INVALID_SHEET_NAME] Worksheet name cannot exceed 31 characters.");
  }
  if (/[\\/?*\[\]:]/.test(name) || /[\u0000-\u001F]/.test(name)) {
    throw new Error("[INVALID_SHEET_NAME] Worksheet name cannot contain \\ / ? * [ ] : or control characters.");
  }
  if (name.startsWith("'") || name.endsWith("'")) {
    throw new Error("[INVALID_SHEET_NAME] Worksheet name cannot begin or end with an apostrophe.");
  }
  return name;
}

function nowIso() {
  return new Date().toISOString();
}

function newId(prefix) {
  return `${prefix}_${crypto.randomBytes(8).toString("hex")}`;
}

function ensureDir(dirPath) {
  if (!dirPath) {
    throw new Error("Directory path is required");
  }
  fs.mkdirSync(dirPath, { recursive: true });
  return dirPath;
}

function storeRoot(workspacePath) {
  if (!workspacePath || typeof workspacePath !== "string" || !path.isAbsolute(workspacePath)) {
    throw new Error(
      "[INVALID_WORKSPACE_PATH] workspacePath must be a host-provided absolute path."
    );
  }
  return path.join(path.resolve(workspacePath), ...STORE_ROOT_SEGMENTS);
}

function workbookDir(workspacePath, workbookId) {
  const safeId = validateWorkbookId(workbookId);
  const root = storeRoot(workspacePath);
  const dir = path.resolve(root, safeId);
  if (!dir.startsWith(`${path.resolve(root)}${path.sep}`)) {
    throw new Error("[INVALID_WORKBOOK_ID] workbookId resolved outside the workbook store root.");
  }
  return dir;
}

function workbookJsonPath(workspacePath, workbookId) {
  return path.join(workbookDir(workspacePath, workbookId), "workbook.json");
}

function createEmptySheet(name, rows = 50, cols = 26) {
  return {
    id: newId("sheet"),
    name: validateExcelSheetName(name || "Sheet1"),
    rows: Math.max(1, Number(rows) || 50),
    cols: Math.max(1, Number(cols) || 26),
    cells: {},
    layout: defaultSheetLayout(),
  };
}

function defaultSheetLayout() {
  return {
    units: { columnWidth: "excelCharacters", rowHeight: "points" },
    columns: [],
    rows: [],
    freezePanes: { rows: 0, columns: 0 },
    autoFilter: null,
  };
}

function normalizeSheetLayout(value) {
  const input = value && typeof value === "object" ? value : {};
  const normalizeBands = (items, sizeKey) => {
    if (!Array.isArray(items)) return [];
    const bands = [];
    for (const item of items) {
      if (!item || typeof item !== "object") continue;
      const start = Number(item.start);
      const end = item.end == null ? start : Number(item.end);
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start) {
        continue;
      }
      const band = { start, end };
      if (item[sizeKey] != null && Number.isFinite(Number(item[sizeKey])) && Number(item[sizeKey]) > 0) {
        band[sizeKey] = Number(item[sizeKey]);
      }
      if (item.autoFit === true) band.autoFit = true;
      if (band[sizeKey] != null || band.autoFit === true) bands.push(band);
    }
    return bands.sort((a, b) => a.start - b.start || a.end - b.end);
  };
  const freeze = input.freezePanes && typeof input.freezePanes === "object"
    ? input.freezePanes
    : {};
  const freezeRows = Number(freeze.rows || 0);
  const freezeColumns = Number(freeze.columns || 0);
  const autoFilter = input.autoFilter && typeof input.autoFilter === "object"
    && typeof input.autoFilter.a1 === "string" && input.autoFilter.a1.trim()
    ? { a1: input.autoFilter.a1.trim() }
    : null;
  return {
    units: { columnWidth: "excelCharacters", rowHeight: "points" },
    columns: normalizeBands(input.columns, "width"),
    rows: normalizeBands(input.rows, "height"),
    freezePanes: {
      rows: Number.isSafeInteger(freezeRows) && freezeRows >= 0 ? freezeRows : 0,
      columns: Number.isSafeInteger(freezeColumns) && freezeColumns >= 0 ? freezeColumns : 0,
    },
    autoFilter,
  };
}

function validateWorkbookId(workbookId) {
  if (
    typeof workbookId !== "string" ||
    !WORKBOOK_ID_PATTERN.test(workbookId) ||
    WINDOWS_RESERVED_NAMES.test(workbookId)
  ) {
    throw new Error(
      "[INVALID_WORKBOOK_ID] workbookId must be 1-128 safe ASCII characters (letters, digits, underscore, or hyphen), must start with a letter or digit, and must not be a reserved device name."
    );
  }
  return workbookId;
}

function normalizeMode(value) {
  return SUPPORTED_MODES.has(value) ? value : "edit";
}

function formatFromPath(filePath) {
  const ext = path.extname(String(filePath || "")).toLowerCase();
  return ext ? ext.slice(1) : null;
}

function defaultFidelity(sourceFormat) {
  const format = String(sourceFormat || "").toLowerCase() || null;
  if (!format) {
    return {
      level: "native",
      canRoundTrip: true,
      canOverwriteSource: false,
      preserved: [
        "cell values",
        "basic formulas",
        "authored cell styles and number formats",
        "column widths and row heights",
        "freeze panes and auto filters",
        "sheet names",
      ],
      unsupported: [],
      warning: null,
    };
  }
  if (format === "json") {
    return {
      level: "native",
      canRoundTrip: true,
      canOverwriteSource: false,
      preserved: ["Sparo workbook state"],
      unsupported: [],
      warning: "Imported sources are protected from overwrite by default.",
    };
  }
  if (format === "csv") {
    return {
      level: "limited",
      canRoundTrip: false,
      canOverwriteSource: false,
      preserved: ["active sheet cell values"],
      unsupported: ["multiple sheets", "formulas", "styles", "charts", "workbook metadata"],
      warning: "CSV import does not preserve workbook features. Use Save As to avoid replacing the source.",
    };
  }
  if (format === "xlsx" || format === "xlsm") {
    return {
      level: "source-preserving",
      canRoundTrip: true,
      canOverwriteSource: false,
      structureChanged: false,
      preserved: [
        "unknown OOXML package parts",
        "existing cell styles and number formats",
        "existing column widths, row heights, freeze panes, and auto filters",
        "sheet names and structure",
        "cell values and formulas",
        format === "xlsm" ? "macros and VBA package parts" : "workbook package metadata",
      ],
      unsupported: [
        "new or changed styles during source-preserving patch",
        "new or changed layout during source-preserving patch",
        "structural edits",
        "formula calculation in the live engine",
      ],
      warning: "Value/formula-only edits can be patched into a copy of the source package. New styles or layout require an acknowledged Save As rebuild; source overwrite remains protected.",
    };
  }
  return {
    level: "limited",
    canRoundTrip: false,
    canOverwriteSource: false,
    preserved: ["sheet names", "cell values", "basic formulas", "cached formula values"],
    unsupported: [
      "styles and number formats",
      "merged cells",
      "data validation",
      "tables and named ranges",
      "charts and drawings",
      "comments and pivot tables",
      "macros and VBA",
    ],
    warning: "This engine cannot losslessly round-trip Excel files. Use Save As to protect the source.",
  };
}

function countFormulas(sheets) {
  let count = 0;
  for (const sheet of sheets || []) {
    for (const cell of Object.values(sheet.cells || {})) {
      if (cell && (cell.formulaEvidence === true || cell.f)) count += 1;
    }
  }
  return count;
}

function defaultCalculationStatus(sheets) {
  const formulaCount = countFormulas(sheets);
  return {
    engine: "none",
    status: formulaCount > 0 ? "cached" : "not-required",
    formulaCount,
    lastCalculatedRevision: null,
    warning: formulaCount > 0
      ? "Formula results are cached values; this engine does not recalculate formulas."
      : null,
  };
}

function createEmpty(options = {}) {
  const title = options.title || "Untitled Workbook";
  const rows = options.rows == null ? 50 : options.rows;
  const cols = options.cols == null ? 26 : options.cols;
  const sheet = createEmptySheet(options.sheetName || "Sheet1", rows, cols);
  const createdAt = nowIso();
  const workbookId = options.workbookId || newId("wb");
  validateWorkbookId(workbookId);
  return {
    schemaVersion: WORKBOOK_SCHEMA_VERSION,
    workbookId,
    path: options.path || null,
    sourcePath: options.sourcePath || null,
    sourceFormat: options.sourceFormat || null,
    sourceFingerprint: options.sourceFingerprint || null,
    lastExportPath: null,
    lastExportedRevision: null,
    lastExportFingerprint: null,
    title,
    sheets: [sheet],
    activeSheetId: sheet.id,
    dirty: false,
    revision: 0,
    mode: normalizeMode(options.mode),
    focus: {
      sheetId: sheet.id,
      a1: "A1",
      kind: "cell",
    },
    proposal: null,
    fidelity: defaultFidelity(options.sourceFormat),
    calculationStatus: defaultCalculationStatus([sheet]),
    history: [],
    undoStack: [],
    redoStack: [],
    createdAt,
    updatedAt: createdAt,
  };
}

function normalizeWorkbook(raw) {
  if (!raw || typeof raw !== "object") {
    throw new Error("Invalid workbook JSON");
  }
  if (!raw.workbookId) {
    throw new Error("Workbook is missing workbookId");
  }
  validateWorkbookId(raw.workbookId);
  if (!Array.isArray(raw.sheets) || raw.sheets.length === 0) {
    throw new Error("Workbook must contain at least one sheet");
  }
  const normalizedSheetNames = new Set();
  const sheets = raw.sheets.map((sheet, index) => {
    if (!sheet || typeof sheet !== "object") {
      throw new Error(`Invalid sheet at index ${index}`);
    }
    const name = validateExcelSheetName(sheet.name || `Sheet${index + 1}`);
    const nameKey = name.toLowerCase();
    if (normalizedSheetNames.has(nameKey)) {
      throw new Error(`[DUPLICATE_SHEET_NAME] Worksheet name already exists: ${name}`);
    }
    normalizedSheetNames.add(nameKey);
    return {
      id: sheet.id || newId("sheet"),
      name,
      rows: Math.max(1, Number(sheet.rows) || 50),
      cols: Math.max(1, Number(sheet.cols) || 26),
      cells: sheet.cells && typeof sheet.cells === "object" ? sheet.cells : {},
      layout: normalizeSheetLayout(sheet.layout),
      complexFormulaRanges: Array.isArray(sheet.complexFormulaRanges)
        ? sheet.complexFormulaRanges
        : [],
    };
  });
  const activeSheetId =
    sheets.find((s) => s.id === raw.activeSheetId)?.id || sheets[0].id;
  const focus = raw.focus && typeof raw.focus === "object"
    ? {
        sheetId: sheets.find((s) => s.id === raw.focus.sheetId)?.id || activeSheetId,
        a1: raw.focus.a1 || "A1",
        kind: raw.focus.kind || "cell",
      }
    : { sheetId: activeSheetId, a1: "A1", kind: "cell" };

  const revision = Number.isSafeInteger(raw.revision) && raw.revision >= 0
    ? raw.revision
    : 0;
  const sourcePath = raw.sourcePath || raw.source?.path || raw.path || null;
  const sourceFormat = raw.sourceFormat || raw.source?.format || formatFromPath(sourcePath);
  const defaultCalculation = defaultCalculationStatus(sheets);
  const calculationStatus = raw.calculationStatus && typeof raw.calculationStatus === "object"
    ? {
        ...defaultCalculation,
        ...raw.calculationStatus,
        formulaCount: defaultCalculation.formulaCount,
      }
    : defaultCalculation;
  const proposal = raw.proposal && typeof raw.proposal === "object"
    ? {
        ...raw.proposal,
        baseRevision: Number.isSafeInteger(raw.proposal.baseRevision)
          ? raw.proposal.baseRevision
          : revision,
        intent: raw.proposal.intent || null,
        validation: raw.proposal.validation || null,
        layout: raw.proposal.layout && typeof raw.proposal.layout === "object"
          ? {
              before: normalizeSheetLayout(raw.proposal.layout.before),
              after: normalizeSheetLayout(raw.proposal.layout.after),
            }
          : null,
      }
    : null;

  return {
    schemaVersion: WORKBOOK_SCHEMA_VERSION,
    workbookId: raw.workbookId,
    path: raw.path || null,
    sourcePath,
    sourceFormat,
    sourceFingerprint:
      raw.sourceFingerprint && typeof raw.sourceFingerprint === "object"
        ? raw.sourceFingerprint
        : null,
    lastExportPath: raw.lastExportPath || null,
    lastExportedRevision: Number.isSafeInteger(raw.lastExportedRevision)
      ? raw.lastExportedRevision
      : null,
    lastExportFingerprint:
      raw.lastExportFingerprint && typeof raw.lastExportFingerprint === "object"
        ? raw.lastExportFingerprint
        : null,
    title: raw.title || "Untitled Workbook",
    sheets,
    activeSheetId,
    dirty: Boolean(raw.dirty),
    revision,
    mode: normalizeMode(raw.mode),
    focus,
    proposal,
    fidelity: raw.fidelity && typeof raw.fidelity === "object"
      ? { ...defaultFidelity(sourceFormat), ...raw.fidelity }
      : defaultFidelity(sourceFormat),
    calculationStatus,
    history: Array.isArray(raw.history) ? raw.history.slice(-500) : [],
    undoStack: Array.isArray(raw.undoStack) ? raw.undoStack.slice(-100) : [],
    redoStack: Array.isArray(raw.redoStack) ? raw.redoStack.slice(-100) : [],
    createdAt: raw.createdAt || nowIso(),
    updatedAt: raw.updatedAt || nowIso(),
  };
}

function loadJson(workspacePath, workbookId) {
  const filePath = workbookJsonPath(workspacePath, workbookId);
  if (!fs.existsSync(filePath)) {
    throw new Error(`Workbook store not found: ${filePath}`);
  }
  const text = fs.readFileSync(filePath, "utf8");
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error(`Failed to parse workbook store JSON: ${error.message}`);
  }
  return normalizeWorkbook(parsed);
}

function listWorkbookMetas(workspacePath) {
  const root = storeRoot(workspacePath);
  if (!fs.existsSync(root)) return [];
  const metas = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const filePath = path.join(root, entry.name, "workbook.json");
    if (!fs.existsSync(filePath)) continue;
    try {
      const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
      if (!parsed || !parsed.workbookId) continue;
      validateWorkbookId(parsed.workbookId);
      metas.push({
        workbookId: parsed.workbookId,
        title: parsed.title || "Untitled Workbook",
        path: parsed.path || null,
        dirty: Boolean(parsed.dirty),
        revision: Number.isSafeInteger(parsed.revision) ? parsed.revision : 0,
        mode: normalizeMode(parsed.mode),
        sourcePath: parsed.sourcePath || parsed.path || null,
        sourceFormat: parsed.sourceFormat || formatFromPath(parsed.sourcePath || parsed.path),
        sourceFingerprint:
          parsed.sourceFingerprint && typeof parsed.sourceFingerprint === "object"
            ? parsed.sourceFingerprint
            : null,
        lastExportPath: parsed.lastExportPath || null,
        lastExportedRevision: Number.isSafeInteger(parsed.lastExportedRevision)
          ? parsed.lastExportedRevision
          : null,
        lastExportFingerprint:
          parsed.lastExportFingerprint && typeof parsed.lastExportFingerprint === "object"
            ? parsed.lastExportFingerprint
            : null,
        sheetCount: Array.isArray(parsed.sheets) ? parsed.sheets.length : 0,
        createdAt: parsed.createdAt || null,
        updatedAt: parsed.updatedAt || null,
      });
    } catch (_error) {
      // Skip unreadable stores; they should not break listing.
    }
  }
  metas.sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));
  return metas;
}

function normalizePathIdentity(value, platform = process.platform) {
  const resolved = path.resolve(String(value || "")).replaceAll("\\", "/");
  return platform === "win32" ? resolved.toLowerCase() : resolved;
}

function findWorkbookIdByPath(workspacePath, filePath) {
  if (!filePath) return null;
  const wanted = normalizePathIdentity(filePath);
  for (const meta of listWorkbookMetas(workspacePath)) {
    if (
      (meta.sourcePath && normalizePathIdentity(meta.sourcePath) === wanted) ||
      (meta.path && normalizePathIdentity(meta.path) === wanted)
    ) {
      return meta.workbookId;
    }
  }
  return null;
}

function saveJson(workspacePath, workbook) {
  if (!workbook || !workbook.workbookId) {
    throw new Error("Cannot save workbook without workbookId");
  }
  const dir = workbookDir(workspacePath, workbook.workbookId);
  ensureDir(dir);
  const next = {
    ...workbook,
    updatedAt: nowIso(),
  };
  const filePath = workbookJsonPath(workspacePath, workbook.workbookId);
  const tempPath = path.join(
    dir,
    `.workbook.json.${process.pid}.${crypto.randomBytes(6).toString("hex")}.tmp`
  );
  let handle = null;
  try {
    handle = fs.openSync(tempPath, "wx", 0o600);
    fs.writeFileSync(handle, `${JSON.stringify(next, null, 2)}\n`, "utf8");
    fs.fsyncSync(handle);
    fs.closeSync(handle);
    handle = null;
    fs.renameSync(tempPath, filePath);
  } catch (error) {
    if (handle != null) {
      try {
        fs.closeSync(handle);
      } catch (_closeError) {
        // Preserve the original save error.
      }
    }
    try {
      if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
    } catch (_cleanupError) {
      // Best-effort cleanup; never mask the original save error.
    }
    throw new Error(`Failed to atomically save workbook store: ${error.message}`);
  }
  return next;
}

function cellKey(row, col) {
  return `${row},${col}`;
}

function getSheet(workbook, sheetId) {
  if (!workbook) {
    throw new Error("Workbook is required");
  }
  const id = sheetId || workbook.activeSheetId;
  const sheet = workbook.sheets.find((s) => s.id === id);
  if (!sheet) {
    throw new Error(`Sheet not found: ${id}`);
  }
  return sheet;
}

function findSheetByName(workbook, name) {
  if (!name) {
    return null;
  }
  const lower = String(name).toLowerCase();
  return workbook.sheets.find((s) => String(s.name).toLowerCase() === lower) || null;
}

module.exports = {
  STORE_ROOT_SEGMENTS,
  WORKBOOK_SCHEMA_VERSION,
  WORKBOOK_ID_PATTERN,
  ensureDir,
  storeRoot,
  workbookDir,
  workbookJsonPath,
  createEmptySheet,
  defaultSheetLayout,
  normalizeSheetLayout,
  createEmpty,
  validateWorkbookId,
  validateExcelSheetName,
  defaultFidelity,
  defaultCalculationStatus,
  normalizeMode,
  formatFromPath,
  normalizeWorkbook,
  loadJson,
  saveJson,
  listWorkbookMetas,
  findWorkbookIdByPath,
  normalizePathIdentity,
  cellKey,
  getSheet,
  findSheetByName,
  newId,
  nowIso,
};
