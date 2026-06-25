const { callHarmonyRuntime } = require("./harmony_bridge");

async function run(input, context) {
  return callHarmonyRuntime(
    input?.includeDiagnostics ? "readDiagnostics" : "getRuntimeState",
    input,
    context,
    "Loaded the HarmonyOS runtime context.",
  );
}

module.exports = { run };
