const { callDeckEngine } = require("./ppt_bridge");

async function run(input) {
  return callDeckEngine("prepareVisualAssets", input, "Prepared whole-deck visual assets after Design Case approval.");
}

module.exports = { run };
