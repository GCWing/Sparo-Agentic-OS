const { callExcelEngine } = require("./excel_bridge");

async function run(input, context) {
  return callExcelEngine(
    "openWorkbook",
    input,
    context,
    "Opened the workbook into an Excel Live session.",
  );
}

module.exports = { run };
