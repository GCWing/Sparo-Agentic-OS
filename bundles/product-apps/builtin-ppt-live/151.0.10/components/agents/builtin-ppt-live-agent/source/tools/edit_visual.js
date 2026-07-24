const { callDeckEngine } = require("./ppt_bridge");

async function run(input) {
  return callDeckEngine("editVisual", input, "Applied a focused visual presentation edit.");
}

module.exports = { run };
