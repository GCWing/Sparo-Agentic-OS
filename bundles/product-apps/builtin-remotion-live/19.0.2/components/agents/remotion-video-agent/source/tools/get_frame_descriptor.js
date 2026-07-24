const { callVideoEngine } = require("./remotion_bridge");

async function run(input, context) {
  return callVideoEngine(
    "getFrameDescriptor",
    input,
    context,
    "Read the non-visual Remotion frame descriptor.",
  );
}

module.exports = { run };
