const { callDeckEngine } = require("./ppt_bridge");

async function run(input) {
  return callDeckEngine("generateSlideVisual", input, `Generated visual page ${input?.slide?.id || ""}.`.trim());
}

module.exports = { run };
