const { callExcelEngine } = require("./excel_bridge");

async function run(input, context) {
  return callExcelEngine(
    "rejectProposal",
    input,
    context,
    "Rejected the active spreadsheet proposal without changing committed cells.",
  );
}

module.exports = { run };
