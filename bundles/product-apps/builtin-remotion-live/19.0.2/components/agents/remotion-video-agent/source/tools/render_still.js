const { callVideoEngine } = require("./remotion_bridge");

async function run(input, context) {
  return callVideoEngine(
    "renderStill",
    input,
    context,
    "Rendered a Remotion still for review.",
  );
}

module.exports = { run };
