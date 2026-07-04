const { callHarmonyRuntime } = require("./harmony_bridge");

async function run(input, context) {
  return callHarmonyRuntime(
    "dumpHierarchy",
    input,
    context,
    "Captured HarmonyOS UI hierarchy evidence.",
  );
}

module.exports = { run };
