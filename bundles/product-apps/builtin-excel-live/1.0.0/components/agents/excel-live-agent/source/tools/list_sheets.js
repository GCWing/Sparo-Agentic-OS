const { callExcelEngine } = require("./excel_bridge");

async function run(input, context) {
  return callExcelEngine(
    "listSheets",
    input,
    context,
    "Listed workbook sheets.",
  );
}

module.exports = { run };
