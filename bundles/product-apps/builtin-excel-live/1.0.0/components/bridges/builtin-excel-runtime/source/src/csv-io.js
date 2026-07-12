/**
 * Minimal CSV parse / serialize with quote handling.
 */

const {
  EXCEL_MAX_COLUMNS,
  EXCEL_MAX_ROWS,
} = require("./a1");

const MAX_CSV_PARSED_CELLS = 500_000;

function positiveLimit(value, fallback, name) {
  if (value == null) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error(`[CSV_LIMIT_INVALID] ${name} must be a positive safe integer.`);
  }
  return parsed;
}

function parseCsv(text, options = {}) {
  const source = text == null ? "" : String(text);
  const maxRows = Math.min(
    EXCEL_MAX_ROWS,
    positiveLimit(options.maxRows, EXCEL_MAX_ROWS, "maxRows")
  );
  const maxColumns = Math.min(
    EXCEL_MAX_COLUMNS,
    positiveLimit(options.maxColumns, EXCEL_MAX_COLUMNS, "maxColumns")
  );
  const maxCells = positiveLimit(
    options.maxCells,
    MAX_CSV_PARSED_CELLS,
    "maxCells"
  );
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  let i = 0;
  let parsedCellCount = 0;

  const pushField = () => {
    if (row.length >= maxColumns) {
      throw new Error(
        `[CSV_COLUMN_LIMIT] CSV row exceeds the maximum of ${maxColumns} columns.`
      );
    }
    parsedCellCount += 1;
    if (parsedCellCount > maxCells) {
      throw new Error(
        `[CSV_CELL_COUNT_LIMIT] CSV contains more than ${maxCells} parsed cells.`
      );
    }
    row.push(field);
    field = "";
  };

  const pushRow = () => {
    if (rows.length >= maxRows) {
      throw new Error(
        `[CSV_ROW_LIMIT] CSV contains more than ${maxRows} rows.`
      );
    }
    rows.push(row);
    row = [];
  };

  while (i < source.length) {
    const ch = source[i];
    if (inQuotes) {
      if (ch === '"') {
        if (source[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += ch;
      i += 1;
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (ch === ",") {
      pushField();
      i += 1;
      continue;
    }
    if (ch === "\r") {
      if (source[i + 1] === "\n") {
        i += 1;
      }
      pushField();
      pushRow();
      i += 1;
      continue;
    }
    if (ch === "\n") {
      pushField();
      pushRow();
      i += 1;
      continue;
    }
    field += ch;
    i += 1;
  }

  if (inQuotes) {
    throw new Error("Unterminated quoted field in CSV");
  }

  if (field.length > 0 || row.length > 0 || source.endsWith(",") || source.endsWith("\n") || source.endsWith("\r")) {
    // Avoid counting or materializing a phantom blank row after a final
    // newline. A trailing comma still represents a real empty field.
    const isTrailingEmpty =
      row.length === 0 &&
      field === "" &&
      rows.length > 0 &&
      (source.endsWith("\n") || source.endsWith("\r"));
    if (!isTrailingEmpty) {
      pushField();
      pushRow();
    }
  }

  return rows;
}

function needsQuotes(value) {
  return /[",\r\n]/.test(value);
}

function serializeField(value) {
  if (value == null) {
    return "";
  }
  const text = String(value);
  if (needsQuotes(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function serializeCsv(rows) {
  if (!Array.isArray(rows)) {
    throw new Error("serializeCsv expects an array of rows");
  }
  return rows
    .map((row) => {
      const cells = Array.isArray(row) ? row : [row];
      return cells.map(serializeField).join(",");
    })
    .join("\n");
}

module.exports = {
  MAX_CSV_PARSED_CELLS,
  parseCsv,
  serializeCsv,
};
