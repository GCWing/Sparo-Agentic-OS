const { callExcelEngine } = require("./excel_bridge");

async function run(input, context) {
  return callExcelEngine(
    "acceptProposal",
    input,
    context,
    "Accepted the active spreadsheet proposal into committed cells.",
  );
}

module.exports = { run };
