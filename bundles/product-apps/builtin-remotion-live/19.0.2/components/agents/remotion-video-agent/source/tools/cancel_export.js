const { callVideoEngine } = require("./remotion_bridge");

async function run(input, context) {
  return callVideoEngine(
    "cancelExport",
    input,
    context,
    "Requested cancellation of the Remotion export.",
  );
}

module.exports = { run };
