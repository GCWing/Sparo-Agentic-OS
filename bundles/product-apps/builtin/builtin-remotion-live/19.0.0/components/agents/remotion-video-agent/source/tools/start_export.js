const { callVideoEngine } = require("./remotion_bridge");

async function run(input, context) {
  return callVideoEngine(
    "startExport",
    input,
    context,
    "Started a Remotion video export.",
  );
}

module.exports = { run };
