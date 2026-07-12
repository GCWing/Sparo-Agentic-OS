const { callExcelEngine } = require("./excel_bridge");

function buildStructureCall(input = {}) {
  const common = {
    workbookId: input.workbookId,
    expectedRevision: input.expectedRevision,
    intent: input.intent,
  };
  if (input.sheetId) common.sheetId = input.sheetId;

  switch (input.operation) {
    case "add_sheet":
      return {
        action: "addSheet",
        payload: {
          ...common,
          ...(input.name ? { name: input.name } : {}),
          ...(input.rows != null ? { rows: input.rows } : {}),
          ...(input.columns != null ? { cols: input.columns } : {}),
          ...(input.activate != null ? { activate: input.activate } : {}),
        },
        summary: "Added a revisioned worksheet. This structural change is committed immediately and remains undoable.",
      };
    case "rename_sheet":
      if (!input.name) throw new Error("rename_sheet requires name");
      return {
        action: "renameSheet",
        payload: { ...common, name: input.name },
        summary: "Renamed a worksheet as a revisioned, undoable structural change.",
      };
    case "insert_rows":
    case "insert_columns":
    case "delete_rows":
    case "delete_columns": {
      if (!Number.isInteger(input.index) || input.index < 1) {
        throw new Error(`${input.operation} requires a 1-based index`);
      }
      const actions = {
        insert_rows: "insertRows",
        insert_columns: "insertColumns",
        delete_rows: "deleteRows",
        delete_columns: "deleteColumns",
      };
      return {
        action: actions[input.operation],
        payload: {
          ...common,
          at: input.index - 1,
          count: input.count == null ? 1 : input.count,
        },
        summary: "Applied a revisioned, undoable worksheet structure change. Formula-bearing workbooks are rejected when references cannot be rewritten safely.",
      };
    }
    default:
      throw new Error(`Unsupported workbook structure operation: ${input.operation || "missing operation"}`);
  }
}

async function run(input, context) {
  const call = buildStructureCall(input);
  switch (call.action) {
    case "addSheet":
      return callExcelEngine("addSheet", call.payload, context, call.summary);
    case "renameSheet":
      return callExcelEngine("renameSheet", call.payload, context, call.summary);
    case "insertRows":
      return callExcelEngine("insertRows", call.payload, context, call.summary);
    case "insertColumns":
      return callExcelEngine("insertColumns", call.payload, context, call.summary);
    case "deleteRows":
      return callExcelEngine("deleteRows", call.payload, context, call.summary);
    case "deleteColumns":
      return callExcelEngine("deleteColumns", call.payload, context, call.summary);
    default:
      throw new Error(`Unsupported Excel Engine structure action: ${call.action}`);
  }
}

module.exports = { run, buildStructureCall };
