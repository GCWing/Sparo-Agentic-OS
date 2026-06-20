const { callVideoEngine } = require("./remotion_bridge");

async function run(input, context) {
  return callVideoEngine(
    "getFrameContext",
    input,
    context,
    "Evaluated the active Remotion frame context.",
  );
}

module.exports = { run };
