const { callExcelEngine } = require("./excel_bridge");

async function run(input, context) {
  return callExcelEngine(
    "getMeta",
    input,
    context,
    "Fetched workbook metadata from the Excel Engine.",
  );
}

module.exports = { run };
