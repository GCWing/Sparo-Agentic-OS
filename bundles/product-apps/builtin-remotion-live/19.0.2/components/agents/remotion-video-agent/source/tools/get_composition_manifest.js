const { callVideoEngine } = require("./remotion_bridge");

async function run(input, context) {
  const action = input && input.forceCompile ? "compileProject" : "getCompositionManifest";
  const { forceCompile, ...request } = input || {};
  return callVideoEngine(
    action,
    forceCompile ? { ...request, force: true } : request,
    context,
    "Loaded the Remotion composition manifest.",
  );
}

module.exports = { run };
