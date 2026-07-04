const { callVideoEngine } = require("./remotion_bridge");

async function run(input, context) {
  const action = input && input.forceCompile ? "compileProject" : "getCompositionManifest";
  return callVideoEngine(
    action,
    input,
    context,
    "Loaded the Remotion composition manifest.",
  );
}

module.exports = { run };
