const { callHarmonyRuntime } = require("./harmony_bridge");

async function run(input, context) {
  return callHarmonyRuntime(
    "captureScreen",
    input,
    context,
    "Captured HarmonyOS screen evidence.",
  );
}

module.exports = { run };
