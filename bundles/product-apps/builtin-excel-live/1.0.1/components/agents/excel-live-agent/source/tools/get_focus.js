const { callExcelEngine } = require("./excel_bridge");

async function run(input, context) {
  return callExcelEngine(
    "getFocus",
    input,
    context,
    "Fetched the current ambient spreadsheet focus.",
  );
}

module.exports = { run };
