const { callExcelEngine } = require("./excel_bridge");

async function run(input, context) {
  return callExcelEngine(
    "switchSheet",
    input,
    context,
    "Switched the active workbook sheet.",
  );
}

module.exports = { run };
