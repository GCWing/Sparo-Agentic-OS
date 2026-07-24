const { callExcelEngine } = require("./excel_bridge");

async function run(input, context) {
  return callExcelEngine(
    "readRange",
    input,
    context,
    "Read the requested spreadsheet range.",
  );
}

module.exports = { run };
