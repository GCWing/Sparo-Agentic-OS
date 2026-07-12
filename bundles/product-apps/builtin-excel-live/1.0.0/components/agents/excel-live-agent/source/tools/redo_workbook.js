const { callExcelEngine } = require("./excel_bridge");

async function run(input, context) {
  return callExcelEngine(
    "redo",
    input,
    context,
    "Redo the latest undone workbook operation and return the new revision.",
  );
}

module.exports = { run };
