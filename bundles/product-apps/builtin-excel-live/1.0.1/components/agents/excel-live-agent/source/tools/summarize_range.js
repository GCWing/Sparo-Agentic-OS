const { callExcelEngine } = require("./excel_bridge");

async function run(input, context) {
  return callExcelEngine(
    "summarizeRange",
    input,
    context,
    "Summarized the requested spreadsheet range.",
  );
}

module.exports = { run };
