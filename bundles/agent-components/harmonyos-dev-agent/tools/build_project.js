const { callHarmonyRuntime } = require("./harmony_bridge");

async function run(input, context) {
  return callHarmonyRuntime(
    "buildProject",
    input,
    context,
    "Ran the HarmonyOS build pipeline.",
  );
}

module.exports = { run };
