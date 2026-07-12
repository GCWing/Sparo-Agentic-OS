/**
 * A1 reference helpers (0-based row/col indices).
 */

const EXCEL_MAX_ROWS = 1_048_576;
const EXCEL_MAX_COLUMNS = 16_384;

function assertCellCoordinates(row, col, context = "Cell") {
  if (
    !Number.isSafeInteger(row) ||
    !Number.isSafeInteger(col) ||
    row < 0 ||
    col < 0 ||
    row >= EXCEL_MAX_ROWS ||
    col >= EXCEL_MAX_COLUMNS
  ) {
    throw new Error(
      `[EXCEL_CELL_LIMIT] ${context} must be within rows 1-${EXCEL_MAX_ROWS} and columns A-XFD using safe integer coordinates.`
    );
  }
  return { row, col };
}

function assertSheetDimensions(rows, cols, context = "Worksheet") {
  if (
    !Number.isSafeInteger(rows) ||
    !Number.isSafeInteger(cols) ||
    rows < 1 ||
    cols < 1 ||
    rows > EXCEL_MAX_ROWS ||
    cols > EXCEL_MAX_COLUMNS
  ) {
    throw new Error(
      `[EXCEL_SHEET_LIMIT] ${context} must have 1-${EXCEL_MAX_ROWS} rows and 1-${EXCEL_MAX_COLUMNS} columns.`
    );
  }
  return { rows, cols };
}

function colToIndex(col) {
  if (col == null || typeof col !== "string" || !col.length) {
    throw new Error("Column letter is required");
  }
  const upper = col.toUpperCase();
  if (!/^[A-Z]{1,3}$/.test(upper)) {
    throw new Error(`Invalid column letters: ${col}`);
  }
  let index = 0;
  for (let i = 0; i < upper.length; i += 1) {
    index = index * 26 + (upper.charCodeAt(i) - 64);
  }
  const zeroBased = index - 1;
  if (!Number.isSafeInteger(zeroBased) || zeroBased >= EXCEL_MAX_COLUMNS) {
    throw new Error(
      `[EXCEL_COLUMN_LIMIT] Column ${upper} exceeds Excel's maximum column XFD.`
    );
  }
  return zeroBased;
}

function indexToCol(index) {
  if (!Number.isSafeInteger(index) || index < 0 || index >= EXCEL_MAX_COLUMNS) {
    throw new Error(`Invalid column index: ${index}`);
  }
  let n = index + 1;
  let col = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    col = String.fromCharCode(65 + rem) + col;
    n = Math.floor((n - 1) / 26);
  }
  return col;
}

function parseCellToken(token) {
  const match = String(token || "")
    .trim()
    .toUpperCase()
    .match(/^([A-Z]+)(\d+)$/);
  if (!match) {
    throw new Error(`Invalid A1 cell reference: ${token}`);
  }
  const c = colToIndex(match[1]);
  const rowNumber = Number(match[2]);
  if (!Number.isSafeInteger(rowNumber) || rowNumber < 1 || rowNumber > EXCEL_MAX_ROWS) {
    throw new Error(
      `[EXCEL_ROW_LIMIT] Row ${match[2]} exceeds Excel's supported range 1-${EXCEL_MAX_ROWS}.`
    );
  }
  const r = rowNumber - 1;
  assertCellCoordinates(r, c, `Cell ${match[1]}${match[2]}`);
  return { c, r };
}

/**
 * Parse an A1 range or cell.
 * Accepts: "A1", "A1:B10", "Sheet1!A1:B2", "'My Sheet'!A1"
 * @returns {{ sheet: string|null, r1: number, c1: number, r2: number, c2: number }}
 */
function parseA1(ref) {
  if (ref == null || String(ref).trim() === "") {
    throw new Error("A1 reference is required");
  }
  let raw = String(ref).trim();
  let sheet = null;

  const bang = raw.lastIndexOf("!");
  if (bang >= 0) {
    sheet = raw.slice(0, bang).trim();
    raw = raw.slice(bang + 1).trim();
    if (
      (sheet.startsWith("'") && sheet.endsWith("'")) ||
      (sheet.startsWith('"') && sheet.endsWith('"'))
    ) {
      sheet = sheet.slice(1, -1).replace(/''/g, "'");
    }
  }

  const parts = raw.split(":");
  if (parts.length === 1) {
    const cell = parseCellToken(parts[0]);
    return { sheet, r1: cell.r, c1: cell.c, r2: cell.r, c2: cell.c };
  }
  if (parts.length !== 2) {
    throw new Error(`Invalid A1 range: ${ref}`);
  }
  const a = parseCellToken(parts[0]);
  const b = parseCellToken(parts[1]);
  return {
    sheet,
    r1: Math.min(a.r, b.r),
    c1: Math.min(a.c, b.c),
    r2: Math.max(a.r, b.r),
    c2: Math.max(a.c, b.c),
  };
}

function formatA1(r1, c1, r2 = r1, c2 = c1) {
  assertCellCoordinates(r1, c1, "Range start");
  assertCellCoordinates(r2, c2, "Range end");
  const top = Math.min(r1, r2);
  const left = Math.min(c1, c2);
  const bottom = Math.max(r1, r2);
  const right = Math.max(c1, c2);
  const start = `${indexToCol(left)}${top + 1}`;
  if (top === bottom && left === right) {
    return start;
  }
  return `${start}:${indexToCol(right)}${bottom + 1}`;
}

function cellCount(r1, c1, r2, c2) {
  assertCellCoordinates(r1, c1, "Range start");
  assertCellCoordinates(r2, c2, "Range end");
  const rows = Math.abs(r2 - r1) + 1;
  const cols = Math.abs(c2 - c1) + 1;
  const count = rows * cols;
  if (!Number.isSafeInteger(count)) {
    throw new Error("[EXCEL_RANGE_LIMIT] Range cell count exceeds JavaScript safe integer limits.");
  }
  return count;
}

function clampRange(range, maxRows, maxCols) {
  if (!range || typeof range !== "object") {
    throw new Error("Range is required");
  }
  const rows = Number(maxRows);
  const cols = Number(maxCols);
  assertSheetDimensions(rows, cols, "Worksheet bounds");
  const r1 = Math.max(0, Math.min(Number(range.r1) || 0, rows - 1));
  const c1 = Math.max(0, Math.min(Number(range.c1) || 0, cols - 1));
  const r2 = Math.max(r1, Math.min(Number(range.r2) || r1, rows - 1));
  const c2 = Math.max(c1, Math.min(Number(range.c2) || c1, cols - 1));
  return {
    sheet: range.sheet == null ? null : range.sheet,
    r1,
    c1,
    r2,
    c2,
  };
}

module.exports = {
  EXCEL_MAX_ROWS,
  EXCEL_MAX_COLUMNS,
  assertCellCoordinates,
  assertSheetDimensions,
  colToIndex,
  indexToCol,
  parseA1,
  formatA1,
  cellCount,
  clampRange,
};
