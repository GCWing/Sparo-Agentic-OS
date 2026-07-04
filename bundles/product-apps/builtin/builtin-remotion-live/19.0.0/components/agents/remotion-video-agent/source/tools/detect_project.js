const { callVideoEngine } = require("./remotion_bridge");

async function run(input, context) {
  return callVideoEngine(
    "detectProject",
    input,
    context,
    "Detected the Remotion project context.",
  );
}

module.exports = { run };
