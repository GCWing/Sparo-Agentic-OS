const { callVideoEngine } = require("./remotion_bridge");

async function run(input = {}, context) {
  const action = input.mode === "studio" ? "ensurePreviewServer" : "ensurePlayerPreviewHost";
  return callVideoEngine(
    action,
    input,
    context,
    input.mode === "studio"
      ? "Refreshed the Remotion Studio preview server."
      : "Refreshed the embedded Remotion Player preview host.",
  );
}

module.exports = { run };
