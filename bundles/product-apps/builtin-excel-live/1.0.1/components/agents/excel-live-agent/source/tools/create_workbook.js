const { callExcelEngine } = require("./excel_bridge");

async function run(input, context) {
  return callExcelEngine(
    "createWorkbook",
    input,
    context,
    "Created an empty workbook session.",
  );
}

module.exports = { run };
