const { callHarmonyRuntime } = require("./harmony_bridge");

async function run(input, context) {
  return callHarmonyRuntime(
    "detectProject",
    input,
    context,
    "Detected the HarmonyOS project identity.",
  );
}

module.exports = { run };
