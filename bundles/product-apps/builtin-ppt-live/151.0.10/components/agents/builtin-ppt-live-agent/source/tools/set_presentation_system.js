const { callDeckEngine } = require("./ppt_bridge");

async function run(input) {
  return callDeckEngine("setPresentationSystem", input, "Committed a complete presentation design system.");
}

module.exports = { run };
