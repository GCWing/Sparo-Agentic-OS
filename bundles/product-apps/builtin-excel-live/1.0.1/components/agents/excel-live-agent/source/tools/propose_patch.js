const { callExcelEngine } = require("./excel_bridge");

const MAX_COMPILED_CELLS = 5000;
const RESULT_CELL_LIMIT = 200;

function columnToIndex(label) {
  let result = 0;
  for (const char of label.toUpperCase()) {
    result = result * 26 + char.charCodeAt(0) - 64;
  }
  return result - 1;
}

function parseA1Range(value) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("A1 range is required for this proposal operation");
  }
  const unqualified = value.trim().split("!").pop().replaceAll("$", "");
  const match = unqualified.match(/^([A-Za-z]+)([1-9]\d*)(?::([A-Za-z]+)([1-9]\d*))?$/);
  if (!match) {
    throw new Error(`Unsupported A1 range: ${value}`);
  }
  const r1 = Number(match[2]) - 1;
  const c1 = columnToIndex(match[1]);
  const r2 = match[4] ? Number(match[4]) - 1 : r1;
  const c2 = match[3] ? columnToIndex(match[3]) : c1;
  if (r2 < r1 || c2 < c1) {
    throw new Error(`A1 range must run from top-left to bottom-right: ${value}`);
  }
  return { r1, c1, r2, c2 };
}

function sheetQualifier(value) {
  if (typeof value !== "string") return null;
  const separator = value.lastIndexOf("!");
  return separator > 0 ? value.slice(0, separator) : null;
}

function matrixCells(a1, values, formulaOnly = false) {
  const { r1, c1 } = parseA1Range(a1);
  const cells = [];
  for (let rowOffset = 0; rowOffset < values.length; rowOffset += 1) {
    const row = values[rowOffset];
    if (!Array.isArray(row)) {
      throw new Error("Each values row must be an array");
    }
    for (let colOffset = 0; colOffset < row.length; colOffset += 1) {
      const raw = row[colOffset];
      const cell = { row: r1 + rowOffset, col: c1 + colOffset };
      if (formulaOnly) {
        if (typeof raw !== "string" || !raw.trim()) {
          throw new Error("set_formulas values must be non-empty formula strings");
        }
        cell.formula = raw.trim().replace(/^=/, "");
      } else if (typeof raw === "string" && raw.trim().startsWith("=")) {
        cell.formula = raw.trim().slice(1);
      } else {
        cell.value = raw;
      }
      cells.push(cell);
    }
  }
  return cells;
}

function styleCells(a1, styleRole, style) {
  const range = parseA1Range(a1);
  const count = (range.r2 - range.r1 + 1) * (range.c2 - range.c1 + 1);
  if (count > MAX_COMPILED_CELLS) {
    throw new Error(
      `apply_style expands to ${count} cells; narrow the range below ${MAX_COMPILED_CELLS}`,
    );
  }
  const cells = [];
  for (let row = range.r1; row <= range.r2; row += 1) {
    for (let col = range.c1; col <= range.c2; col += 1) {
      cells.push({
        row,
        col,
        ...(styleRole ? { styleRole } : {}),
        ...(style !== undefined ? { style } : {}),
      });
    }
  }
  return cells;
}

function deepMerge(base, addition) {
  if (
    base &&
    addition &&
    typeof base === "object" &&
    typeof addition === "object" &&
    !Array.isArray(base) &&
    !Array.isArray(addition)
  ) {
    const result = { ...base };
    for (const [key, value] of Object.entries(addition)) {
      result[key] = key in result ? deepMerge(result[key], value) : value;
    }
    return result;
  }
  return addition;
}

function mergeLayout(base = {}, addition = {}) {
  const additionHasColumns = Object.prototype.hasOwnProperty.call(addition || {}, "columns");
  const additionHasRows = Object.prototype.hasOwnProperty.call(addition || {}, "rows");
  const merged = {
    ...deepMerge(base || {}, addition || {}),
    columns: additionHasColumns && addition.columns.length === 0
      ? []
      : [...(base?.columns || []), ...(addition?.columns || [])],
    rows: additionHasRows && addition.rows.length === 0
      ? []
      : [...(base?.rows || []), ...(addition?.rows || [])],
  };
  if (!merged.columns.length && !(additionHasColumns || Object.prototype.hasOwnProperty.call(base || {}, "columns"))) {
    delete merged.columns;
  }
  if (!merged.rows.length && !(additionHasRows || Object.prototype.hasOwnProperty.call(base || {}, "rows"))) {
    delete merged.rows;
  }
  return merged;
}

function mergeCells(cells) {
  const merged = new Map();
  for (const cell of cells) {
    if (!Number.isInteger(cell?.row) || !Number.isInteger(cell?.col)) {
      throw new Error("Compiled proposal cells require integer row and col coordinates");
    }
    const key = `${cell.row}:${cell.col}`;
    const prior = merged.get(key) || { row: cell.row, col: cell.col };
    const next = {
      ...prior,
      ...cell,
      ...(Object.prototype.hasOwnProperty.call(prior, "style") || Object.prototype.hasOwnProperty.call(cell, "style")
        ? {
          style: Object.prototype.hasOwnProperty.call(cell, "style")
            ? deepMerge(prior.style || {}, cell.style)
            : prior.style,
        }
        : {}),
    };
    if (Object.prototype.hasOwnProperty.call(cell, "style") && cell.style === null) {
      delete next.styleRole;
    }
    merged.set(key, next);
  }
  if (merged.size > MAX_COMPILED_CELLS) {
    throw new Error(`Proposal exceeds the maximum of ${MAX_COMPILED_CELLS} compiled cells`);
  }
  return [...merged.values()];
}

function normalizeExplicitStyleClears(cells) {
  return cells.map((cell) => {
    if (!cell || cell.style !== null) return cell;
    const normalized = { ...cell };
    delete normalized.styleRole;
    return normalized;
  });
}

function compileProposalInput(input = {}) {
  if (!Array.isArray(input.operations) || input.operations.length === 0) {
    return {
      ...input,
      ...(Array.isArray(input.cells) ? { cells: normalizeExplicitStyleClears(input.cells) } : {}),
      resultCellLimit: RESULT_CELL_LIMIT,
    };
  }

  const payload = { ...input };
  delete payload.operations;
  payload.resultCellLimit = RESULT_CELL_LIMIT;
  const cells = [...(Array.isArray(input.cells) ? input.cells : [])];
  let operationSheet = null;
  if (Array.isArray(input.values)) {
    cells.push(...matrixCells(input.a1 || "A1", input.values));
    delete payload.values;
  }
  let layout = input.layout || {};

  for (const operation of input.operations) {
    const qualifier = sheetQualifier(operation?.a1);
    if (qualifier && input.sheetId) {
      throw new Error("Use sheetId or a sheet-qualified operation A1, not both");
    }
    if (qualifier && operationSheet && qualifier !== operationSheet) {
      throw new Error("One proposal cannot target operations on multiple sheets");
    }
    if (qualifier) operationSheet = qualifier;
    switch (operation?.kind) {
      case "set_cells":
        if (!Array.isArray(operation.cells) || operation.cells.length === 0) {
          throw new Error("set_cells requires a non-empty cells array");
        }
        cells.push(...operation.cells);
        break;
      case "set_values":
        if (!Array.isArray(operation.values)) {
          throw new Error("set_values requires values[][]");
        }
        cells.push(...matrixCells(operation.a1, operation.values));
        break;
      case "set_formulas":
        if (!Array.isArray(operation.values)) {
          throw new Error("set_formulas requires values[][]");
        }
        cells.push(...matrixCells(operation.a1, operation.values, true));
        break;
      case "apply_style":
        if (!operation.styleRole && !Object.prototype.hasOwnProperty.call(operation, "style")) {
          throw new Error("apply_style requires styleRole and/or style");
        }
        cells.push(...styleCells(operation.a1, operation.styleRole, operation.style));
        break;
      case "set_layout":
        if (!operation.layout || typeof operation.layout !== "object") {
          throw new Error("set_layout requires layout");
        }
        layout = mergeLayout(layout, operation.layout);
        break;
      default:
        throw new Error(`Unsupported proposal operation: ${operation?.kind || "missing kind"}`);
    }
  }

  if (operationSheet && !input.sheetId) {
    const inputSheet = sheetQualifier(input.a1);
    if (inputSheet && inputSheet !== operationSheet) {
      throw new Error("Root patch and proposal operations must target the same sheet");
    }
    if (!inputSheet) payload.a1 = `${operationSheet}!${input.a1 || "A1"}`;
  }
  if (cells.length) payload.cells = mergeCells(cells);
  if (Object.keys(layout).length) payload.layout = layout;
  return payload;
}

async function run(input, context) {
  return callExcelEngine(
    "proposePatch",
    compileProposalInput(input),
    context,
    "Proposed workbook content, formula, style, or layout changes for grid review. Not applied until Accept.",
  );
}

module.exports = {
  run,
  compileProposalInput,
  deepMerge,
  matrixCells,
  parseA1Range,
  sheetQualifier,
  normalizeExplicitStyleClears,
  RESULT_CELL_LIMIT,
};
