const { callExcelEngine } = require("./excel_bridge");

function buildSaveInput(input = {}) {
  if (
    input.acknowledgeFidelityLoss === true &&
    (typeof input.path !== "string" || !input.path.toLowerCase().endsWith(".xlsx"))
  ) {
    throw new Error(
      "acknowledgeFidelityLoss=true is allowed only for an explicit Save As to a distinct .xlsx path",
    );
  }
  return {
    ...input,
    acknowledgeFidelityLoss: input.acknowledgeFidelityLoss === true,
    exportCopy: true,
    allowSourceOverwrite: false,
  };
}

async function run(input, context) {
  return callExcelEngine(
    "saveWorkbook",
    buildSaveInput(input),
    context,
    "Exported the reviewed workbook revision to a separate copy.",
  );
}

module.exports = { run, buildSaveInput };
