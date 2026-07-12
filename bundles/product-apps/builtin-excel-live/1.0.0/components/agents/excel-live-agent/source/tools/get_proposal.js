const { callExcelEngine } = require("./excel_bridge");

async function run(input, context) {
  return callExcelEngine(
    "getProposal",
    { ...input, resultCellLimit: 200 },
    context,
    "Fetched the active spreadsheet proposal.",
  );
}

module.exports = { run };
