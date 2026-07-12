const { callVideoEngine } = require("./remotion_bridge");

async function run(input = {}, context) {
  return callVideoEngine(
    "ensurePlayerPreviewHost",
    input,
    context,
    "Refreshed the embedded Remotion Player preview host.",
  );
}

module.exports = { run };
