const { callVideoEngine } = require("./remotion_bridge");

async function run(input, context) {
  return callVideoEngine(
    "getExportStatus",
    input,
    context,
    "Read the current Remotion export status.",
  );
}

module.exports = { run };
