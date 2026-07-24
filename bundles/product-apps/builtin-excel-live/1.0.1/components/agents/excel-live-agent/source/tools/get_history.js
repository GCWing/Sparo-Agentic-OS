const { callExcelEngine } = require("./excel_bridge");

async function run(input, context) {
  return callExcelEngine(
    "getHistory",
    input,
    context,
    "Read compact workbook revision and undo/redo history.",
  );
}

module.exports = { run };
