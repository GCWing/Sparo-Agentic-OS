const { callExcelEngine } = require("./excel_bridge");

async function run(input, context) {
  return callExcelEngine(
    "undo",
    input,
    context,
    "Undo the latest committed workbook operation and return the new revision.",
  );
}

module.exports = { run };
